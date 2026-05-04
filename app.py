import threading
import time
import sys
import sqlite3
import os       
import shutil   
from datetime import datetime, timedelta
from flask import Flask, render_template, jsonify, request, redirect, session
from werkzeug.utils import secure_filename
from werkzeug.security import generate_password_hash 
from tridy import Zamestnanec, Admin
from struktury import HistorieDochazky, BSTUzivatelu, serad_zaznamy_podle_casu
from functools import wraps
import logging

# Potlačíme výpisy Werkzeugu (Flask dev server) — v terminálu uvidíme jen naše vlastní zprávy
logging.getLogger('werkzeug').setLevel(logging.ERROR)

# =====================================================================
# INICIALIZACE APLIKACE A GLOBÁLNÍ STAV
# =====================================================================

aplikace = Flask(__name__)
# Secret key podepisuje session cookies — načítáme z prostředí, fallback pro vývoj
aplikace.secret_key = os.environ.get('SECRET_KEY', 'Dochazkac1.')
DB_SOUBOR = "dochazka.db"

# Globální datové struktury sdílené mezi všemi požadavky
databaze_uzivatelu = BSTUzivatelu()   # BST pro rychlé vyhledávání zaměstnanců
logy_dochazky = HistorieDochazky()    # Spojový seznam záznamů docházky
_zamek_dat = threading.Lock()          # Zámek pro bezpečný přístup z více vláken


# =====================================================================
# BEZPEČNOSTNÍ DEKORÁTOR
# =====================================================================

def vyzaduj_admina(f):
    """Dekorátor chránící API endpoint před neautorizovaným přístupem.
    
    Zkontroluje Flask session — pokud admin není přihlášen, vrátí 401.
    Použití: @vyzaduj_admina nad definicí route funkce.
    """
    @wraps(f)
    def wrapper(*args, **kwargs):
        if not session.get('admin_prihlasen'):
            return jsonify({"uspech": False, "chyba": "Neautorizovaný přístup. Přihlaste se."}), 401
        return f(*args, **kwargs)
    return wrapper


# =====================================================================
# NAČÍTÁNÍ DAT Z DATABÁZE DO PAMĚTI
# =====================================================================

def nacti_data_z_db():
    """Načte všechna data z SQLite do globálních datových struktur v paměti.
    
    Provádí se při startu aplikace a po každé operaci, která mění data
    (přidání/smazání zaměstnance apod.). Data se načítají nejprve do
    dočasných struktur a teprve po úspěšném dokončení se atomicky
    přepíší globální proměnné — zamezí se tak nekonzistentnímu stavu.
    """
    global databaze_uzivatelu, logy_dochazky 
    
    # Dočasné struktury — plníme je, a až jsou hotové, přepíšeme globální
    nova_databaze = BSTUzivatelu() 
    nove_logy = HistorieDochazky() 
    pocet_nactenych_uzivatelu = 0
    
    try:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        
        # --- 0. AUTOMATICKÉ VYTVOŘENÍ TABULEK (při prvním spuštění) ---
        cursor.execute("CREATE TABLE IF NOT EXISTS nastaveni (klic TEXT PRIMARY KEY, hodnota TEXT)")
        
        cursor.execute('''CREATE TABLE IF NOT EXISTS zamestnanci (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            jmeno TEXT NOT NULL,
                            role TEXT NOT NULL,
                            cip_hash TEXT,
                            pin_hash TEXT,
                            email TEXT,
                            username TEXT,
                            heslo_hash TEXT,
                            hlaska_prichod TEXT,
                            hlaska_odchod TEXT
                        )''')
                        
        cursor.execute('''CREATE TABLE IF NOT EXISTS logy (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            datum TEXT,
                            cas TEXT,
                            jmeno TEXT,
                            akce TEXT,
                            metoda TEXT
                        )''')
                        
        cursor.execute('''CREATE TABLE IF NOT EXISTS admin_logy (
                            id INTEGER PRIMARY KEY AUTOINCREMENT,
                            datum TEXT,
                            cas TEXT,
                            jmeno TEXT,
                            metoda TEXT,
                            uspesne INTEGER
                        )''')
        conn.commit()
        
        # --- 1. AUTOMATICKÁ GDPR ÚDRŽBA ---
        # Před načtením dat smažeme záznamy starší než nastavená retenční lhůta
        cursor.execute("SELECT hodnota FROM nastaveni WHERE klic='gdpr_retence'")
        retence_row = cursor.fetchone()
        retence = retence_row[0] if retence_row else "1rok"

        if retence != "nikdy":
            nyni = datetime.now()
            if retence == "1rok":
                mez = nyni - timedelta(days=365)
            elif retence == "3roky":
                mez = nyni - timedelta(days=3*365)
            else:
                mez = nyni - timedelta(days=365)

            str_mez = mez.strftime("%Y-%m-%d")
            cursor.execute("DELETE FROM logy WHERE datum < ?", (str_mez,))
            cursor.execute("DELETE FROM admin_logy WHERE datum < ?", (str_mez,)) 
            conn.commit()

        # --- 2. NAČTENÍ ZAMĚSTNANCŮ DO DOČASNÉ STRUKTURY ---
        # Hashe čipů/PINů/hesel přiřazujeme přímo — obejdeme tím validaci
        # v konstruktoru, která očekává čistý text, ne hash.
        try:
            cursor.execute("SELECT id, jmeno, role, cip_hash, pin_hash, email, username, heslo_hash, hlaska_prichod, hlaska_odchod FROM zamestnanci")
            radky = cursor.fetchall()
            
            for r in radky:
                if r[7]:  # Přítomnost heslo_hash → jde o Admina
                    osoba = Admin(
                        id_osoby=r[0], jmeno=r[1], role=r[2], 
                        cip=None, pin=None,   # Nepředáváme čistý text — hash nastavíme ručně níže
                        email=r[5], username=r[6], heslo=None, 
                        hlaska_prichod=r[8], hlaska_odchod=r[9]
                    )
                    osoba.cip_hash = r[3]
                    osoba.pin_hash = r[4]
                    osoba.heslo_hash = r[7]
                else:  # Bez heslo_hash → běžný zaměstnanec
                    osoba = Zamestnanec(
                        id_osoby=r[0], jmeno=r[1], role=r[2], 
                        cip=None, pin=None, 
                        hlaska_prichod=r[8], hlaska_odchod=r[9]
                    )
                    osoba.cip_hash = r[3]
                    osoba.pin_hash = r[4]
                
                nova_databaze.vloz(osoba)
                pocet_nactenych_uzivatelu += 1
                
        except Exception as ez:
            print(f"Chyba u načítání konkrétních uživatelů: {ez}")

        # --- 3. NAČTENÍ LOGŮ DO DOČASNÉ STRUKTURY ---
        # Řadíme ASC (od nejstaršího) — HistorieDochazky vkládá na hlavu,
        # takže na konci bude hlava obsahovat nejnovější záznam.
        cursor.execute("SELECT id, datum, cas, jmeno, akce, metoda FROM logy ORDER BY datum ASC, cas ASC")
        for log in cursor.fetchall():
            nove_logy.pridej_zaznam(log[0], log[1], log[2], log[3], log[4], log[5])

        conn.close()

        # --- 4. BEZPEČNÝ PŘEPIS GLOBÁLNÍ PAMĚTI ---
        # Zámek zajistí, že žádné vlákno nečte data právě ve chvíli, kdy je přepisujeme
        with _zamek_dat:
            databaze_uzivatelu = nova_databaze
            logy_dochazky = nove_logy
            
        # Výpis pouze v hlavním pracovním procesu (Flask debug spouští dva procesy)
        if os.environ.get('WERKZEUG_RUN_MAIN') == 'true':
            print("\n" + "="*50)
            print(f"[START SYSTÉMU] Databáze úspěšně načtena!")
            print(f" ➔ Počet uživatelů: {pocet_nactenych_uzivatelu}")
            print(f" ➔ Počet záznamů docházky: {len(nove_logy)}")
            print(f" ➔ Čas startu: {datetime.now().strftime('%d.%m.%Y %H:%M:%S')}")
            print("="*50 + "\n")

    except Exception as e:
        print(f"KRITICKÁ CHYBA PŘI NAČÍTÁNÍ DATABÁZE: {e}")

# Spustíme ihned při importu modulu — naplní paměť před prvním požadavkem
nacti_data_z_db()


# =====================================================================
# VLÁKNA NA POZADÍ — AUTOMATICKÉ ÚLOHY
# =====================================================================

def proved_automaticke_odhlaseni():
    """Vygeneruje chybějící odchody pro zaměstnance, kteří zapomněli pípnout.
    
    Pro každého, kdo má jako poslední záznam předchozích dnů 'Příchod',
    přidá automatický 'Odchod' v čase 23:59:59. Lze vypnout v nastavení.
    """
    dneska = datetime.now().strftime("%Y-%m-%d")
    chybejici = logy_dochazky.najdi_chybejici_odchody(dneska)

    if chybejici:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        
        # Zkontrolujeme, zda má admin funkci automatického odhlašování zapnutou
        cursor.execute("SELECT hodnota FROM nastaveni WHERE klic='term_auto_odchod'")
        nastaveni = cursor.fetchone()
        if nastaveni and nastaveni[0] == 'false':
            conn.close()
            return 
        
        for clovek in chybejici:
            str_cas = "23:59:59"
            cursor.execute(
                "INSERT INTO logy (id, datum, cas, jmeno, akce, metoda) VALUES (?, ?, ?, ?, ?, ?)",
                (None, clovek['datum'], str_cas, clovek['jmeno'], 'Odchod', 'Systém (Auto)')
            )
        
        conn.commit()
        conn.close()
        
        # Znovu načteme data, aby se nové záznamy propsaly do paměti
        nacti_data_z_db() 
        print(f"Byly vygenerovány automatické odchody pro: {[c['jmeno'] for c in chybejici]}")

def vlakno_pro_odhlasovani():
    """Smyčka vlákna — každou minutu spustí kontrolu chybějících odchodů."""
    while True:
        try:
            proved_automaticke_odhlaseni()
        except Exception as e:
            print(f"Chyba při automatickém odhlášení: {e}")
        time.sleep(60)

# Paměť pro datum poslední provedené zálohy — zabrání vícenásobnému spuštění v jednom dni
_posledni_den_kontroly = None

def automaticke_ulohy():
    """Smyčka vlákna — každou minutu zkontroluje, zda nenastal nový den.
    
    Pokud datum neodpovídá zapamatovanému, spustí automatické zálohy
    a datum si uloží, aby zálohu neopakoval do dalšího dne.
    """
    global _posledni_den_kontroly
    while True:
        nyni = datetime.now()
        dnesni_datum = nyni.strftime("%Y-%m-%d")

        if _posledni_den_kontroly != dnesni_datum:
            proved_automaticke_zalohy(nyni)
            _posledni_den_kontroly = dnesni_datum
            
        time.sleep(60)

def proved_automaticke_zalohy(nyni):
    """Zkopíruje databázový soubor do složky zalohy_databaze, pokud je záloha zapnutá.
    
    Frekvenci zálohy (denně / týdně / měsíčně) čte z tabulky nastavení.
    """
    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()
    cursor.execute("SELECT klic, hodnota FROM nastaveni")
    nastaveni = dict(cursor.fetchall())
    conn.close()

    zapnuto_db = nastaveni.get('zaloha_db_zapnuto', 'false') == 'true'
    frekvence = nastaveni.get('zaloha_frekvence', 'denne')

    if not zapnuto_db:
        return  # Automatické zálohy jsou vypnuté v nastavení

    # Rozhodneme se podle frekvence a aktuálního dne
    rozhodnuti_zalohovat = False
    if frekvence == 'denne':
        rozhodnuti_zalohovat = True
    elif frekvence == 'tydne' and nyni.weekday() == 0:  # Pondělí = 0
        rozhodnuti_zalohovat = True
    elif frekvence == 'mesicne' and nyni.day == 1:       # První den v měsíci
        rozhodnuti_zalohovat = True

    if not rozhodnuti_zalohovat:
        return

    str_datum = nyni.strftime("%d-%m-%Y")
    slozka_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zalohy_databaze")
    
    try:
        os.makedirs(slozka_db, exist_ok=True)
        nazev_souboru = f"zaloha_databaze_{str_datum}.db"
        cil_db = os.path.join(slozka_db, nazev_souboru)
        
        shutil.copy(DB_SOUBOR, cil_db)
        
        print(f"\n[SYSTÉM] Automatická záloha databáze byla úspěšně vytvořena: '{nazev_souboru}'\n")
        loguj_systemovou_akci(f"Automatická záloha: {nazev_souboru}", uspesne=1)
    except Exception as e:
        print(f"\n[CHYBA SYSTÉMU] Selhala automatická záloha databáze: {str(e)}\n")
        loguj_systemovou_akci(f"Chyba při zálohování DB: {str(e)}", uspesne=0)

def loguj_systemovou_akci(metoda, uspesne):
    """Zapíše systémovou událost (záloha, chyba...) do tabulky admin_logy."""
    nyni = datetime.now()
    try:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO admin_logy (datum, cas, jmeno, metoda, uspesne) VALUES (?, ?, ?, ?, ?)",
            (nyni.strftime("%Y-%m-%d"), nyni.strftime("%H:%M:%S"), "Systém (Auto)", metoda, uspesne)
        )
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Nelze zapsat do logu: {e}")


# =====================================================================
# STRÁNKY (HTML ROUTES)
# =====================================================================

@aplikace.route('/')
def hlavni_stranka():
    """Hlavní stránka terminálu. Pokud není žádný zaměstnanec, přesměruje na setup."""
    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM zamestnanci")
        pocet = cursor.fetchone()[0]
    except sqlite3.OperationalError:
        # Tabulka ještě neexistuje (první spuštění) — vytvoříme ji
        pocet = 0 
        nacti_data_z_db()
    finally:
        conn.close()
    
    if pocet == 0:
        return redirect('/setup')
        
    return render_template('index.html')


@aplikace.route('/setup')
def setup_stranka():
    """Průvodce prvním nastavením. Pokud už existují zaměstnanci, vrátí na hlavní stránku."""
    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()
    try:
        cursor.execute("SELECT COUNT(*) FROM zamestnanci")
        pocet = cursor.fetchone()[0]
    except sqlite3.OperationalError:
        pocet = 0 
        nacti_data_z_db()
    finally:
        conn.close()
    
    if pocet > 0:
        return redirect('/') 
        
    return render_template('index.html')

@aplikace.route('/admin')
def admin_stranka():
    """Vyhrazená URL pro administraci — vrací stejný index.html, JS se postará o zbytek."""
    return render_template('index.html')


# =====================================================================
# API — ZAMĚSTNANCI (VEŘEJNÉ)
# =====================================================================

@aplikace.route('/api/uzivatele', methods=['GET'])
def ziskej_uzivatele():
    """Vrátí seznam všech zaměstnanců bez citlivých dat (bez hashů).
    
    Administrátorům přidá navíc email, username a příznak web_pass,
    ale nikdy neposílá samotné hashe hesel, PINů ani čipů.
    """
    bezpecna_data = []
    serazeni_uzivatele = databaze_uzivatelu.ziskej_serazene()
    for u in serazeni_uzivatele:
        data = {
            "id": u.id,
            "jmeno": u.jmeno,
            "role": u.role,
            "hlaska_prichod": u.hlaska_prichod,
            "hlaska_odchod": u.hlaska_odchod
        }
        if hasattr(u, 'heslo_hash') and u.heslo_hash:
            # Přidáme pouze příznak a viditelné údaje, NE hash hesla
            data.update({"email": u.email, "username": u.username, "web_pass": True})
        bezpecna_data.append(data)
    return jsonify(bezpecna_data)


# =====================================================================
# API — AUTENTIZACE SPRÁVCŮ
# =====================================================================

@aplikace.route('/api/admin/login', methods=['POST'])
def admin_login():
    """Přihlášení správce přes webový formulář (username/email + heslo).
    
    Porovná zadané údaje se všemi adminy v BST. Přihlásit se lze
    pomocí jména, e-mailu nebo uživatelského jména.
    """
    data = request.get_json()
    login_input = data.get('login', '').strip().lower()
    heslo = data.get('heslo', '')
    serazeni = databaze_uzivatelu.ziskej_serazene()
    
    for u in serazeni:
        if hasattr(u, 'heslo_hash') and u.heslo_hash:
            if login_input in [u.jmeno.lower(), str(u.email).lower(), str(u.username).lower()]:
                if u.over_heslo(heslo):
                    session['admin_prihlasen'] = True
                    print(f"\n[WEB PŘIHLÁŠENÍ] Správce '{u.jmeno}' (Role: {u.role}) se právě přihlásil do administrace.\n")
                    return jsonify({"uspech": True, "jmeno": u.jmeno, "role": u.role}) 
                    
    print(f"\n[CHYBA PŘIHLÁŠENÍ] Někdo se pokusil přihlásit s chybnými údaji (Zadaný login: '{login_input}').\n")
    return jsonify({"uspech": False, "chyba": "Nesprávné přihlašovací údaje"}), 401

@aplikace.route('/api/admin/logout', methods=['POST'])
def admin_logout():
    """Odhlásí správce — vymaže celou Flask session na straně serveru."""
    session.clear()
    return jsonify({"uspech": True})


# =====================================================================
# API — OVĚŘENÍ ČIPU / PINU (TERMINÁL)
# =====================================================================

@aplikace.route('/api/overit', methods=['POST'])
def overit_pripnuti():
    """Ověří čip nebo PIN a zapíše záznam docházky.
    
    Logika kontroly duplicit:
      - Příchod nelze zapsat dvakrát za sebou
      - Odchod/Lékař/Pauza vyžadují předchozí Příchod
    
    Pokud se ověřuje admin (přes terminál), nahodí mu platnou session
    pro případné otevření administrace bez nutnosti zadávat webové heslo.
    """
    data = request.get_json()
    kod, typ, akce = data.get('kod'), data.get('typ'), data.get('akce')

    if not kod:
        return jsonify({"uspech": False, "chyba": "Chybí kód"}), 400

    u = databaze_uzivatelu.over_pripnuti(kod, typ)
    if u:
        vygenerovane_id = None
        if akce:
            # Získáme záznamy uživatele pro kontrolu poslední akce
            with _zamek_dat:
                zaznamy = logy_dochazky.najdi_zaznamy_uzivatele(u.jmeno)
                
            posledni_akce = zaznamy[0].akce if zaznamy else None

            # Ochrana před duplicitním příchodem nebo odchodem bez příchodu
            if akce == 'Příchod' and posledni_akce == 'Příchod':
                return jsonify({"uspech": False, "chyba": f"{u.jmeno}, již máte zaznamenaný příchod!"}), 400
            if akce in ['Odchod', 'Lékař', 'Pauza'] and posledni_akce != 'Příchod':
                return jsonify({"uspech": False, "chyba": f"{u.jmeno}, nejprve si musíte pípnout příchod!"}), 400

            nyni = time.localtime()
            str_datum = time.strftime("%Y-%m-%d", nyni)
            str_cas = time.strftime("%H:%M:%S", nyni)
            nazev_metody = 'Čip' if typ == 'cip' else 'PIN' if typ == 'pin' else typ.capitalize()

            # Zapíšeme do databáze a získáme vygenerované ID záznamu
            conn = sqlite3.connect(DB_SOUBOR)
            cursor = conn.cursor()
            cursor.execute("INSERT INTO logy (id, datum, cas, jmeno, akce, metoda) VALUES (?, ?, ?, ?, ?, ?)",
                           (None, str_datum, str_cas, u.jmeno, akce, nazev_metody))
            vygenerovane_id = cursor.lastrowid
            conn.commit()
            conn.close()

            # Zapíšeme i do paměťové struktury, aby byl stav okamžitě konzistentní
            with _zamek_dat:
                logy_dochazky.pridej_zaznam(vygenerovane_id, str_datum, str_cas, u.jmeno, akce, nazev_metody)

        odpoved = {
            "uspech": True, 
            "uzivatel_jmeno": u.jmeno, 
            "role": u.role, 
            "hlaska_prichod": u.hlaska_prichod, 
            "hlaska_odchod": u.hlaska_odchod,
            "je_admin": hasattr(u, 'heslo_hash') and bool(u.heslo_hash)
        }
        
        # Pokud se přihlašuje admin nebo privilegovaná role přes terminál,
        # nahodíme mu session — bude moci otevřít administraci bez webového hesla
        if odpoved["je_admin"] or u.role in ['Administrator', 'Reditel', 'Zastupce']:
            session['admin_prihlasen'] = True

        if vygenerovane_id: 
            odpoved["id_zaznamu"] = vygenerovane_id
            
        return jsonify(odpoved)

    return jsonify({"uspech": False, "chyba": "Neznámý čip nebo PIN"}), 401


# =====================================================================
# API — SPRÁVA ZAMĚSTNANCŮ (VYŽADUJE PŘIHLÁŠENÍ)
# =====================================================================

@aplikace.route('/api/uzivatele/ulozit', methods=['POST'])
@vyzaduj_admina
def uloz_uzivatele():
    """Uloží nového zaměstnance nebo aktualizuje existujícího.
    
    Před uložením zkontroluje duplicity jména, PINu a čipu.
    Po uložení do DB provede 'chirurgický zásah' do paměťového BST —
    smaže starý uzel a vloží aktualizovaný, bez nutnosti celého reloadu.
    """
    data = request.get_json()
    u_id = data.get('id')
    jmeno = data.get('jmeno')
    cip = data.get('cip')
    pin = data.get('pin')
    role = data.get('role')
    hl_p = data.get('hlaska_prichod', '')
    hl_o = data.get('hlaska_odchod', '')

    # Kontrola duplicit vůči všem ostatním zaměstnancům (editovaného přeskočíme)
    with _zamek_dat:
        vsichni_uzivatele = databaze_uzivatelu.ziskej_serazene()
    
    for u in vsichni_uzivatele:
        if u_id and u.id == u_id:
            continue  # Editujeme tohoto — přeskočíme porovnání sám se sebou
        if u.jmeno.lower() == jmeno.lower():
            return jsonify({"uspech": False, "chyba": f"Zaměstnanec se jménem '{jmeno}' již existuje!"}), 400
        # Tečky v hodnotě znamenají, že uživatel pole nezměnil — neověřujeme
        if pin and "•" not in pin and u.over_pin(pin):
            return jsonify({"uspech": False, "chyba": "Tento PIN již používá jiný zaměstnanec!"}), 400
        if cip and "•" not in cip and u.over_cip(cip):
            return jsonify({"uspech": False, "chyba": "Tento čip již používá jiný zaměstnanec!"}), 400

    try:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        
        # Zjistíme staré jméno — potřebujeme ho pro smazání starého uzlu ze stromu
        stare_jmeno = None
        if u_id:
            cursor.execute("SELECT jmeno FROM zamestnanci WHERE id=?", (u_id,))
            stary_zaznam = cursor.fetchone()
            if stary_zaznam:
                stare_jmeno = stary_zaznam[0]
        
        # Uložení do databáze — UPDATE pro existující, INSERT pro nového
        if u_id:
            cursor.execute("UPDATE zamestnanci SET jmeno=?, role=?, hlaska_prichod=?, hlaska_odchod=? WHERE id=?", (jmeno, role, hl_p, hl_o, u_id))
            if pin and "•" not in pin: 
                cursor.execute("UPDATE zamestnanci SET pin_hash=? WHERE id=?", (generate_password_hash(pin), u_id))
            if cip and "•" not in cip: 
                cursor.execute("UPDATE zamestnanci SET cip_hash=? WHERE id=?", (generate_password_hash(cip), u_id))
            id_pro_strom = u_id
        else:
            cip_h = generate_password_hash(cip) if cip else None
            pin_h = generate_password_hash(pin) if pin else None
            cursor.execute("INSERT INTO zamestnanci (jmeno, role, cip_hash, pin_hash, hlaska_prichod, hlaska_odchod) VALUES (?, ?, ?, ?, ?, ?)", (jmeno, role, cip_h, pin_h, hl_p, hl_o))
            id_pro_strom = cursor.lastrowid
        
        # Načteme finální podobu řádku pro sestavení objektu do paměti
        cursor.execute("SELECT id, jmeno, role, cip_hash, pin_hash, email, username, heslo_hash, hlaska_prichod, hlaska_odchod FROM zamestnanci WHERE id=?", (id_pro_strom,))
        r = cursor.fetchone()
        
        conn.commit()
        
        # --- ZÁSAH DO PAMĚŤOVÉHO STROMU ---
        # Místo celého reloadu pouze vyměníme jeden uzel — rychlejší a bezpečnější
        if r:
            with _zamek_dat:
                if stare_jmeno:
                    databaze_uzivatelu.smaz_uzivatele(stare_jmeno)
                
                # Sestavíme správný typ objektu podle přítomnosti heslo_hash
                if r[7]:  # Administrátor
                    osoba = Admin(id_osoby=r[0], jmeno=r[1], role=r[2], cip=None, pin=None, email=r[5], username=r[6], heslo=None, hlaska_prichod=r[8], hlaska_odchod=r[9])
                    osoba.cip_hash = r[3]
                    osoba.pin_hash = r[4]
                    osoba.heslo_hash = r[7]
                else:      # Běžný zaměstnanec
                    osoba = Zamestnanec(id_osoby=r[0], jmeno=r[1], role=r[2], cip=None, pin=None, hlaska_prichod=r[8], hlaska_odchod=r[9])
                    osoba.cip_hash = r[3]
                    osoba.pin_hash = r[4]
                    
                databaze_uzivatelu.vloz(osoba)
                
    except sqlite3.Error as e:
        return jsonify({"uspech": False, "chyba": "Chyba databáze: " + str(e)}), 500
    finally:
        if 'conn' in locals() and conn:
            conn.close()

    return jsonify({"uspech": True})

@aplikace.route('/api/admin/ulozit', methods=['POST'])
@vyzaduj_admina
def uloz_admina():
    """Nastaví nebo aktualizuje webové přihlašovací údaje zaměstnance (email, username, heslo).
    
    Pokud není heslo zadáno, zachová stávající hash. Po uložení
    provede chirurgický zásah do BST stejně jako uloz_uzivatele.
    """
    data = request.get_json()
    u_id = data.get('id')
    username = data.get('username')
    email = data.get('email')
    heslo = data.get('heslo')
    
    if not u_id: 
        return jsonify({"uspech": False, "chyba": "Chybí ID uživatele"}), 400
        
    try:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()

        # Zjistíme jméno pro smazání starého uzlu ze stromu
        cursor.execute("SELECT jmeno FROM zamestnanci WHERE id=?", (u_id,))
        zaznam = cursor.fetchone()
        if not zaznam:
            return jsonify({"uspech": False, "chyba": "Uživatel nenalezen"}), 404
        jmeno = zaznam[0]
        
        if heslo:
            cursor.execute("UPDATE zamestnanci SET username = ?, email = ?, heslo_hash = ? WHERE id = ?", 
                           (username, email, generate_password_hash(heslo), u_id))
        else:
            # Heslo nezadáno — zachováme stávající hash
            cursor.execute("UPDATE zamestnanci SET username = ?, email = ? WHERE id = ?", 
                           (username, email, u_id))
            
        # Načteme aktualizovaný řádek pro sestavení nového objektu do stromu
        cursor.execute("SELECT id, jmeno, role, cip_hash, pin_hash, email, username, heslo_hash, hlaska_prichod, hlaska_odchod FROM zamestnanci WHERE id=?", (u_id,))
        r = cursor.fetchone()

        conn.commit()

        # --- ZÁSAH DO PAMĚŤOVÉHO STROMU ---
        if r:
            with _zamek_dat:
                databaze_uzivatelu.smaz_uzivatele(jmeno)
                
                # Rozlišíme, zda jde o Admina nebo běžného zaměstnance
                if r[7]: 
                    osoba = Admin(id_osoby=r[0], jmeno=r[1], role=r[2], cip=None, pin=None, email=r[5], username=r[6], heslo=None, hlaska_prichod=r[8], hlaska_odchod=r[9])
                    osoba.cip_hash = r[3]
                    osoba.pin_hash = r[4]
                    osoba.heslo_hash = r[7]
                else: 
                    osoba = Zamestnanec(id_osoby=r[0], jmeno=r[1], role=r[2], cip=None, pin=None, hlaska_prichod=r[8], hlaska_odchod=r[9])
                    osoba.cip_hash = r[3]
                    osoba.pin_hash = r[4]
                    
                databaze_uzivatelu.vloz(osoba)

    except sqlite3.Error as e:
        return jsonify({"uspech": False, "chyba": "Chyba databáze: " + str(e)}), 500
    finally:
        if 'conn' in locals() and conn:
            conn.close()
            
    return jsonify({"uspech": True})

@aplikace.route('/api/admin/odebrat/<int:u_id>', methods=['DELETE'])
@vyzaduj_admina
def odeber_admina(u_id):
    """Odebere zaměstnanci administrátorská práva (smaže heslo_hash, email, username).
    
    Zaměstnanec zůstane v systému jako běžný uživatel — jen přijde
    o možnost přihlásit se do webové administrace. Nelze odebrat
    práva poslednímu správci v systému.
    """
    try:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()

        cursor.execute("SELECT COUNT(*) FROM zamestnanci WHERE heslo_hash IS NOT NULL")
        pocet_adminu = cursor.fetchone()[0]

        cursor.execute("SELECT heslo_hash, jmeno FROM zamestnanci WHERE id=?", (u_id,))
        odebirany = cursor.fetchone()

        if not odebirany:
            conn.close()
            return jsonify({"uspech": False, "chyba": "Uživatel nenalezen."}), 404

        heslo_hash = odebirany[0]
        jmeno = odebirany[1]

        # Ochrana: nelze odebrat práva poslednímu správci
        if heslo_hash and pocet_adminu <= 1:
            conn.close()
            return jsonify({"uspech": False, "chyba": "Nelze odebrat práva! Jde o posledního správce v systému."}), 400

        # Nulujeme administrátorské sloupce v DB
        cursor.execute("UPDATE zamestnanci SET username=NULL, email=NULL, heslo_hash=NULL WHERE id=?", (u_id,))
        
        # Načteme aktualizovaný řádek pro přestavbu objektu v BST
        cursor.execute("SELECT id, jmeno, role, cip_hash, pin_hash, email, username, heslo_hash, hlaska_prichod, hlaska_odchod FROM zamestnanci WHERE id=?", (u_id,))
        r = cursor.fetchone()

        conn.commit()

        # --- ZÁSAH DO PAMĚŤOVÉHO STROMU ---
        # Z Admina se stává zpět běžný Zamestnanec
        if r:
            with _zamek_dat:
                databaze_uzivatelu.smaz_uzivatele(jmeno)
                osoba = Zamestnanec(id_osoby=r[0], jmeno=r[1], role=r[2], cip=None, pin=None, hlaska_prichod=r[8], hlaska_odchod=r[9])
                osoba.cip_hash = r[3]
                osoba.pin_hash = r[4]
                databaze_uzivatelu.vloz(osoba)

    except sqlite3.Error as e:
        return jsonify({"uspech": False, "chyba": "Chyba databáze: " + str(e)}), 500
    finally:
        if 'conn' in locals() and conn:
            conn.close()
            
    return jsonify({"uspech": True})

@aplikace.route('/api/uzivatele/smazat/<int:id_smazat>', methods=['DELETE'])
@vyzaduj_admina
def smaz_uzivatele(id_smazat):
    """Trvale smaže zaměstnance z databáze i z paměťového BST.
    
    Nelze smazat posledního správce systému. Jméno zjistíme PŘED
    smazáním z DB — po DELETE bychom ho už nezjistili.
    """
    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()

    cursor.execute("SELECT COUNT(*) FROM zamestnanci WHERE heslo_hash IS NOT NULL")
    pocet_adminu = cursor.fetchone()[0]

    # Jméno musíme znát před smazáním — potřebujeme ho pro BST
    cursor.execute("SELECT jmeno, heslo_hash FROM zamestnanci WHERE id=?", (id_smazat,))
    mazany_uzivatel = cursor.fetchone()

    if not mazany_uzivatel:
        conn.close()
        return jsonify({"uspech": False, "chyba": "Uživatel nenalezen."}), 404

    jmeno_smazaneho = mazany_uzivatel[0]
    heslo_hash = mazany_uzivatel[1]

    # Ochrana: nelze smazat posledního správce
    if heslo_hash and pocet_adminu <= 1:
        conn.close()
        return jsonify({"uspech": False, "chyba": "Nelze smazat posledního správce systému!"}), 400

    # 1. Smazání z databáze SQLite
    cursor.execute("DELETE FROM zamestnanci WHERE id=?", (id_smazat,))
    conn.commit()
    conn.close()
    
    # 2. Smazání uzlu přímo z BST v paměti — bez nutnosti celého reloadu
    with _zamek_dat:
        databaze_uzivatelu.smaz_uzivatele(jmeno_smazaneho)
        
    return jsonify({"uspech": True})


# =====================================================================
# API — LOGY DOCHÁZKY
# =====================================================================

@aplikace.route('/api/admin/logy', methods=['GET', 'POST'])
def sprava_admin_logu():
    """Správa logů přístupů do administrace.
    
    GET  — vrátí historii přístupů (seřazenou vlastním algoritmem), vyžaduje přihlášení.
    POST — zapíše nový záznam přístupu (volá ho frontend po každém přihlášení/pokusu).
           POST je záměrně veřejný — frontend ho volá ještě před nastavením session.
    """
    if request.method == 'GET' and not session.get('admin_prihlasen'):
        return jsonify({"uspech": False, "chyba": "Neautorizováno"}), 401

    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()

    if request.method == 'POST':
        novy_log = request.get_json()
        uspesne_int = 1 if novy_log.get('uspesne') else 0
        
        jmeno_log = novy_log.get('jmeno')
        metoda_log = novy_log.get('metoda')
        
        if uspesne_int == 1:
            print(f"\n[ADMIN PŘÍSTUP] Úspěšně ověřen správce: '{jmeno_log}' (Způsob: {metoda_log})\n")
        else:
            print(f"\n[ADMIN ZAMÍTNUTO] Neoprávněný pokus o přístup! Zadáno: '{jmeno_log}' (Způsob: {metoda_log})\n")
        
        cursor.execute(
            "INSERT INTO admin_logy (datum, cas, jmeno, metoda, uspesne) VALUES (?, ?, ?, ?, ?)",
            (novy_log.get('datumKratke'), novy_log.get('cas'), novy_log.get('jmeno'), novy_log.get('metoda'), uspesne_int)
        )
        conn.commit()
        conn.close()
        return jsonify({"uspech": True})
        
    else:
        # Řazení provádí vlastní Insertion Sort, ne SQL — využití algoritmu ze struktury
        cursor.execute("SELECT id, datum, cas, jmeno, metoda, uspesne FROM admin_logy")
        radky = cursor.fetchall()
        conn.close()

        vysledek = []
        for r in radky:
            vysledek.append({
                "id": r[0],
                "datumKratke": r[1],
                "cas": r[2],
                "jmeno": r[3],
                "metoda": r[4],
                "uspesne": bool(r[5])
            })
            
        vysledek = serad_zaznamy_podle_casu(vysledek)
        return jsonify(vysledek)

@aplikace.route('/api/logy', methods=['GET'])
def ziskej_logy():
    """Vrátí záznamy docházky, volitelně filtrované podle jména a/nebo data.
    
    Filtraci a řazení provádí Python (vlastní algoritmy), ne SQL.
    Endpoint je veřejný — terminál ho potřebuje i bez přihlášení správce.
    """
    jmeno = request.args.get('jmeno', '')
    datum_od = request.args.get('od', '')
    datum_do = request.args.get('do', '')

    vyfiltrovane_logy = logy_dochazky.vyfiltruj_zaznamy(jmeno, datum_od, datum_do)
    serazene_logy = serad_zaznamy_podle_casu(vyfiltrovane_logy)
    
    return jsonify(serazene_logy)

@aplikace.route('/api/logy/smazat/<int:id_zaznamu>', methods=['DELETE'])
@vyzaduj_admina
def smaz_log(id_zaznamu):
    """Smaže jeden záznam docházky z paměti i z databáze (funkce 'Vrátit zpět')."""
    uspech = logy_dochazky.smaz_zaznam(id_zaznamu)
    if uspech:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        cursor.execute("DELETE FROM logy WHERE id=?", (id_zaznamu,))
        conn.commit()
        conn.close()
        return jsonify({"uspech": True})
    return jsonify({"uspech": False, "chyba": "Záznam nebyl nalezen."}), 404


# =====================================================================
# API — NASTAVENÍ SYSTÉMU
# =====================================================================

@aplikace.route('/api/nastaveni', methods=['GET', 'POST'])
def sprava_nastaveni():
    """Čtení a ukládání nastavení systému (klíč-hodnota v tabulce nastaveni).
    
    GET  — veřejné (terminál potřebuje tapetu a rozvrh i bez přihlášení).
    POST — chráněné, vyžaduje přihlášeného správce.
    """
    if request.method == 'POST':
        if not session.get('admin_prihlasen'):
            return jsonify({"uspech": False, "chyba": "Neautorizovaný přístup. Přihlaste se."}), 401
            
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        data = request.get_json()
        
        # INSERT OR REPLACE zajistí, že existující klíče se přepíší, nové se přidají
        for klic, hodnota in data.items():
            cursor.execute("INSERT OR REPLACE INTO nastaveni (klic, hodnota) VALUES (?, ?)", (klic, str(hodnota)))
        
        conn.commit()
        conn.close()
        return jsonify({"uspech": True})
        
    else:
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        cursor.execute("SELECT klic, hodnota FROM nastaveni")
        radky = cursor.fetchall()
        conn.close()
        return jsonify({r[0]: r[1] for r in radky})


# =====================================================================
# API — ZÁLOHY A SYSTÉMOVÉ OPERACE
# =====================================================================

@aplikace.route('/api/zalohovat', methods=['POST'])
@vyzaduj_admina
def zalohovat_db():
    """Manuálně zkopíruje databázový soubor do složky zalohy_databaze.
    
    Název souboru obsahuje datum a čas zálohy. Akci zaznamená do admin_logy.
    """
    try:
        data = request.get_json(silent=True) or {}
        jmeno_admina = data.get('jmeno', 'Neznámý správce')

        slozka_db = os.path.join(os.path.dirname(os.path.abspath(__file__)), "zalohy_databaze")
        os.makedirs(slozka_db, exist_ok=True)
        
        nyni = datetime.now()
        nyni_str = nyni.strftime("%d-%m-%Y_%H-%M-%S") 
        nazev_souboru = f"zaloha_databaze_manualni_{nyni_str}.db"
        cil = os.path.join(slozka_db, nazev_souboru)
        
        shutil.copy(DB_SOUBOR, cil)
        
        print(f"\n[SYSTÉM] Správce '{jmeno_admina}' manuálně zazálohoval databázi do souboru: '{nazev_souboru}'\n")
        
        conn = sqlite3.connect(DB_SOUBOR)
        cursor = conn.cursor()
        cursor.execute(
            "INSERT INTO admin_logy (datum, cas, jmeno, metoda, uspesne) VALUES (?, ?, ?, ?, ?)",
            (nyni.strftime("%Y-%m-%d"), nyni.strftime("%H:%M:%S"), jmeno_admina, f"Manuální záloha: {nazev_souboru}", 1)
        )
        conn.commit()
        conn.close()
        
        return jsonify({"uspech": True})
    except Exception as e:
        print(f"\n[CHYBA SYSTÉMU] Selhala manuální záloha databáze: {str(e)}\n")
        return jsonify({"uspech": False, "chyba": f"Nelze zapsat: {str(e)}"}), 500

@aplikace.route('/api/tovarni_reset', methods=['POST'])
def tovarni_reset():
    """Smaže veškerá data ze všech tabulek (tovární reset).
    
    Vyžaduje ověřovací slovo 'RESTARTOVAT' a platné heslo správce.
    Záměrně nepoužívá @vyzaduj_admina — je použitelný i po odhlášení.
    """
    data = request.get_json()
    # Pojistka: uživatel musí napsat přesně "RESTARTOVAT"
    if data.get('potvrzeni') != "RESTARTOVAT":
        return jsonify({"uspech": False, "chyba": "Chybí ověřovací slovo RESTARTOVAT"}), 400

    # Ověříme heslo správce inline (bez session)
    serazeni = databaze_uzivatelu.ziskej_serazene()
    je_opravnen = any(
        u.over_heslo(data.get('heslo', '')) 
        for u in serazeni 
        if hasattr(u, 'heslo_hash') and u.heslo_hash 
        and data.get('login', '').strip().lower() in [u.jmeno.lower(), str(u.email).lower(), str(u.username).lower()]
    )
    
    if not je_opravnen:
        return jsonify({"uspech": False, "chyba": "Nesprávné přihlašovací údaje správce"}), 401
    
    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()
    
    # Smažeme obsah všech tabulek (strukturu zachováme)
    for tabulka in ["zamestnanci", "logy", "nastaveni", "admin_logy"]: 
        cursor.execute(f"DELETE FROM {tabulka}")
        
    conn.commit()
    conn.close()
    
    # Znovu načteme data — struktury budou prázdné, systém přesměruje na /setup
    nacti_data_z_db()
    return jsonify({"uspech": True})

@aplikace.route('/api/setup/dokoncit', methods=['POST'])
def dokonceni_setupu():
    """Endpoint pro první spuštění (Průvodce). 
    Funguje POUZE pokud je databáze zaměstnanců zcela prázdná."""
    
    conn = sqlite3.connect(DB_SOUBOR)
    cursor = conn.cursor()
    
    try:
        # Bezpečnostní pojistka: Opravdu je databáze prázdná?
        cursor.execute("SELECT COUNT(*) FROM zamestnanci")
        pocet = cursor.fetchone()[0]
        if pocet > 0:
            conn.close()
            return jsonify({"uspech": False, "chyba": "Instalace zamítnuta: Systém už je nainstalován."}), 403
        
        # Načtení dat z requestu
        data = request.get_json()
        jmeno = data.get('jmeno')
        pin = data.get('pin')
        username = data.get('username')
        heslo = data.get('heslo')
        email = data.get('email', '')
        
        if not all([jmeno, pin, username, heslo]):
            return jsonify({"uspech": False, "chyba": "Chybí povinná data (jméno, pin, username, heslo)."}), 400
            
        # Vložení prvního administrátora
        pin_hash = generate_password_hash(pin)
        heslo_hash = generate_password_hash(heslo)
        
        cursor.execute("""
            INSERT INTO zamestnanci 
            (jmeno, role, pin_hash, username, heslo_hash, email, hlaska_prichod, hlaska_odchod) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (jmeno, 'Administrator', pin_hash, username, heslo_hash, email, "Vítejte!", "Hezký zbytek dne."))
        
        # Vložení výchozích nastavení terminálu
        vychozi_nastaveni = {
            'term_tapeta': 'dochazkac',
            'term_sporic': '60',
            'term_reset': '30',
            'term_auto_odchod': 'true'
        }
        
        for klic, hodnota in vychozi_nastaveni.items():
            cursor.execute("INSERT OR REPLACE INTO nastaveni (klic, hodnota) VALUES (?, ?)", (klic, str(hodnota)))
            
        conn.commit()
        
    except Exception as e:
        conn.rollback()
        print(f"Chyba při setupu: {e}")
        return jsonify({"uspech": False, "chyba": "Chyba na straně serveru."}), 500
    finally:
        conn.close()
        
    # Přepíšeme paměťové struktury, aby systém okamžitě pracoval s novými daty
    nacti_data_z_db()
    
    # Nahodíme adminovi rovnou platnou session, aby se mohl dostat do administrace
    session['admin_prihlasen'] = True
    
    return jsonify({"uspech": True})

@aplikace.route('/api/system/restart', methods=['POST'])
@vyzaduj_admina
def restart_systemu():
    """Restartuje Flask server (spustí nový proces se stejnými argumenty).
    
    Restart probíhá v samostatném vlákně — Flask stihne odeslat odpověď
    před tím, než se proces ukončí.
    """
    data = request.get_json(silent=True) or {}
    jmeno = data.get('jmeno', 'Neznámý správce')
    
    print(f"\n[SYSTÉM] Správce '{jmeno}' odeslal příkaz k RESTARTU serveru!\n")
    
    def proved_restart():
        time.sleep(1)  # Krátká prodleva, aby se stihla odeslat HTTP odpověď
        os.execl(sys.executable, sys.executable, *sys.argv)
    
    threading.Thread(target=proved_restart).start()
    return jsonify({"uspech": True})

@aplikace.route('/api/system/vypnout', methods=['POST'])
@vyzaduj_admina
def vypnuti_systemu():
    """Ukončí celý Python proces (vypnutí terminálu).
    
    os._exit(0) ukončí proces okamžitě bez cleanup — záměrné,
    aby se předešlo zaseknutí při čekání na vlákna na pozadí.
    """
    data = request.get_json(silent=True) or {}
    jmeno = data.get('jmeno', 'Neznámý správce')
    
    print(f"\n[SYSTÉM] Správce '{jmeno}' odeslal příkaz k trvalému VYPNUTÍ terminálu!\n")
    
    def proved_vypnuti():
        time.sleep(1)
        os._exit(0)
        
    threading.Thread(target=proved_vypnuti).start()
    return jsonify({"uspech": True})


# =====================================================================
# API — SPRÁVA OBRÁZKŮ (TAPETY A LOGA)
# =====================================================================

# Cesty ke složkám s obrázky
SLOZKA_TAPETY = os.path.join('static', 'obrazky', 'tapety')
SLOZKA_LOGA = os.path.join('static', 'obrazky', 'loga')

# Povolené přípony pro nahrávané obrázky
POVOLENE_PRIPONY_OBRAZKU = {'png', 'jpg', 'jpeg', 'webp'}

# Tovární soubory — tyto nelze smazat přes API
ZAKLADNI_TAPETY = ['dochazkac.webp', 'skola.webp']
ZAKLADNI_LOGA = ['dochazkac_logo.png']

# Limit velikosti nahrávaných souborů: 2 MB
MAX_FILE_SIZE = 2 * 1024 * 1024 

def povolena_pripona(filename):
    """Vrátí True, pokud má soubor povolenou příponu obrázku."""
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in POVOLENE_PRIPONY_OBRAZKU

# --- TAPETY ---

@aplikace.route('/api/admin/tapety', methods=['GET'])
def ziskej_tapety():
    """Vrátí seznam dostupných souborů tapet ze složky static/obrazky/tapety."""
    os.makedirs(SLOZKA_TAPETY, exist_ok=True)
    soubory = [f for f in os.listdir(SLOZKA_TAPETY) if povolena_pripona(f)]
    return jsonify(soubory)

@aplikace.route('/api/admin/tapety/upload', methods=['POST'])
@vyzaduj_admina
def upload_tapety():
    """Nahraje novou tapetu. Kontroluje velikost (max 2 MB) a příponu souboru."""
    if request.content_length and request.content_length > MAX_FILE_SIZE:
        return jsonify({"uspech": False, "chyba": "Soubor je příliš velký (maximum jsou 2 MB)."}), 413

    if 'file' not in request.files: 
        return jsonify({"uspech": False, "chyba": "Chybí soubor"}), 400
        
    file = request.files['file']
    if file and povolena_pripona(file.filename):
        filename = secure_filename(file.filename)  # Sanitizace názvu souboru
        file.save(os.path.join(SLOZKA_TAPETY, filename))
        return jsonify({"uspech": True, "soubor": filename})
        
    return jsonify({"uspech": False, "chyba": "Nepovolený formát"}), 400

@aplikace.route('/api/admin/tapety/<filename>', methods=['DELETE'])
@vyzaduj_admina
def smaz_tapetu(filename):
    """Smaže tapetu ze složky. Tovární tapety (ZAKLADNI_TAPETY) nelze smazat."""
    if filename in ZAKLADNI_TAPETY:
        return jsonify({"uspech": False, "chyba": "Tovární tapety nelze smazat!"}), 403
    cesta = os.path.join(SLOZKA_TAPETY, secure_filename(filename))
    if os.path.exists(cesta):
        os.remove(cesta)
    return jsonify({"uspech": True})

# --- LOGA ---

@aplikace.route('/api/admin/loga', methods=['GET'])
def ziskej_loga():
    """Vrátí seznam dostupných log ze složky static/obrazky/loga."""
    os.makedirs(SLOZKA_LOGA, exist_ok=True)
    soubory = [f for f in os.listdir(SLOZKA_LOGA) if povolena_pripona(f)]
    return jsonify(soubory)

@aplikace.route('/api/admin/loga/upload', methods=['POST'])
@vyzaduj_admina
def upload_loga():
    """Nahraje nové logo. Kontroluje velikost (max 2 MB) a příponu souboru."""
    if request.content_length and request.content_length > MAX_FILE_SIZE:
        return jsonify({"uspech": False, "chyba": "Soubor je příliš velký (maximum jsou 2 MB)."}), 413

    if 'file' not in request.files: 
        return jsonify({"uspech": False, "chyba": "Chybí soubor"}), 400
        
    file = request.files['file']
    if file and povolena_pripona(file.filename):
        filename = secure_filename(file.filename)
        file.save(os.path.join(SLOZKA_LOGA, filename))
        return jsonify({"uspech": True, "soubor": filename})
        
    return jsonify({"uspech": False, "chyba": "Nepovolený formát"}), 400

@aplikace.route('/api/admin/loga/<filename>', methods=['DELETE'])
@vyzaduj_admina
def smaz_logo(filename):
    """Smaže logo ze složky. Tovární logo (ZAKLADNI_LOGA) nelze smazat."""
    if filename in ZAKLADNI_LOGA:
        return jsonify({"uspech": False, "chyba": "Tovární logo nelze smazat!"}), 403
    cesta = os.path.join(SLOZKA_LOGA, secure_filename(filename))
    if os.path.exists(cesta):
        os.remove(cesta)
    return jsonify({"uspech": True})


# =====================================================================
# SPUŠTĚNÍ APLIKACE
# =====================================================================
   
if __name__ == '__main__':
    # Vlákno pro automatické doplňování chybějících odchodů (každou minutu)
    pozadove_vlakno = threading.Thread(target=vlakno_pro_odhlasovani, daemon=True)
    pozadove_vlakno.start()
    
    # Vlákno pro automatické zálohy (kontroluje každou minutu, zda nastal nový den)
    vlakno_zaloh_exportu = threading.Thread(target=automaticke_ulohy, daemon=True)
    vlakno_zaloh_exportu.start()
    
    # daemon=True zajistí, že vlákna automaticky skončí, když skončí hlavní proces
    aplikace.run(host='0.0.0.0', port=559, debug=True)
