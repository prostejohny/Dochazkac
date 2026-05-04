<img src="static/obrazky/loga/dochazkac_logo.png" alt="Docházkáč logo" width="120" align="right">

# Docházkáč 1.0 ([Ukázka zde](https://github.com/prostejohny/Dochazkac/tree/main/ukazkove_screenshoty_soubory))

**Předmět:** Algoritmizace a programování 2

## Úvod a motivace
Docházkáč 1.0 je komplexní hardwarově-softwarové řešení docházkového systému, vyvinuté primárně pro potřeby Základní školy ve Štětí (s budoucím plánovaným nasazením i na ZŠ v Mostě). Během června proběhne testování odolnosti učiteli ZŠ, aby mohl být v září pro školní rok 2026/2027 připraven a plně sloužit.

Při pohledu na dostupné docházkové systémy pro školy se ukázalo, že většina z nich má dost nevýhod. Často jsou drahé, vyžadují pravidelné měsíční platby, nemají české prostředí, působí zastarale a nedají se moc přizpůsobit konkrétním potřebám školy. Na základě toho vznikl vlastní systém, který je moderní, funguje jako webová aplikace, dobře se používá na různých zařízeních a nevyžaduje žádný speciální nebo drahý hardware.

## Hardwarové řešení
Díky webové architektuře je aplikace plně nezávislá na konkrétní platformě. Pro účely implementace a testování však byl vytvořen referenční hardwarový terminál, který je sestaven z následujících komponent::
* **Zobrazovač:** 10.1" dotykový displej Waveshare HMI (RPI-HMI-101D-ACCE-EU).
* **Výpočetní jednotka:** Raspberry Pi 5 (4GB RAM) integrované v displeji.
* **Napájení:** PoE (Power over Ethernet) ze stávající síťové infrastruktury (switch).
* **Periferie:** RFID čtečka (13.56 MHz) pracující v režimu emulace klávesnice. Tento standard byl zvolen pro zpětnou kompatibilitu se stávajícími čipy školní jídelny a budoucím napojením na tiskárny a elektronické zámky dveří.
* **Hostování serveru:** Aplikace běží na školním NAS serveru v izolované síti (VLAN VEDENÍ), bez přímého přístupu do veřejné sítě internet.

---

## Architektura softwaru a aplikace teoretických znalostí

Architektura systému je navržena tak, aby v praxi ukazovala aplikaci probírané látky v předmětu Algoritmizace a programování 2. Klíčové datové struktury a algoritmy nebyly převzaty z vestavěných knihoven Pythonu, ale jsou implementovány zcela od základu jako vlastní řešení. Systém je modulárně rozdělen na následující části:

### `tridy.py` – objektový model a využití dědičnosti

Modul implementuje objektově orientovaný přístup pro modelování uživatelů systému. Je zde využita **dědičnost**, kdy od abstraktní základní třídy `Osoba` dědí třída `Zamestnanec` (reprezentující uživatele s čipem/PINem) a z ní následně vychází třída `Admin` (uživatel s rozšířenými administrátorskými oprávněními).

Tento návrh eliminuje duplicitu kódu a zároveň demonstruje praktické využití **polymorfismu**, kdy lze s objekty pracovat jednotně přes společné rozhraní základní třídy.

Nedílnou součástí návrhu je také **zapouzdření a zabezpečení citlivých dat**. Citlivé údaje, jako jsou hesla, osobní PIN kódy nebo identifikátory RFID čipů, nejsou nikdy ukládány v prostém textu (plain text). Místo toho je použita specializovaná kryptografická knihovna, která zajišťuje jejich bezpečné **hashování a šifrování**, čímž se minimalizuje riziko jejich zneužití.

### `struktury.py` (Abstraktní datové typy a spojové struktury)
Tenhle soubor obsahuje vlastní implementace datových struktur vytvořených podle teoretických principů:
*   **Spojový seznam:** Historie docházky je spravována pomocí jednosměrného spojového seznamu (`HistorieDochazky`). Vzhledem k potřebě častého vkládání nových logů na začátek (hlavu) seznamu jde o optimální strukturu s časovou složitostí O(1) pro tuto operaci.
*   **Binární vyhledávací strom (BST):** Správa uživatelů a jejich rychlé dohledávání je řešeno vlastní strukturou `BSTUzivatelu`.
*   **Vlastní algoritmy:** Nad zmíněnými kolekcemi jsou vystavěny vyhledávací a třídící algoritmy (např. vlastní implementace algoritmu *Insertion Sort* pro chronologické řazení záznamů).
*   **Rozhraní a Iterátory:** Pro zajištění iterability vlastních kolekcí (např. použití v cyklech `for`) jsou implementovány iterátory postavené na generátorech (`yield`). Chování je sjednoceno definovaným rozhraním (`SpojovaStruktura`) za použití modulu `typing.Protocol`.

### `app.py` (Aplikační logika a backend)
Hlavní aplikační server propojuje vytvořené datové struktury s reálným backendem ve frameworku Flask. Obsluhuje REST API komunikaci s terminálem, trvalé uložení dat pomocí SQLite databáze a webové relace (sessions). Pomocí modulu `threading` je zde zajištěn i souběžný běh úloh na pozadí (např. automatické doplňování odchodů a periodické zálohování databáze). Ochrana systémových funkcí je pak řešena využitím vlastních bezpečnostních dekorátorů.

---

## Struktura projektu

```text
dochazkac/
├── app.py                  # Hlavní aplikační server (Flask routing, vlákna, API)
├── struktury.py            # Vlastní implementace BST, spojových seznamů a třídění
├── tridy.py                # Hierarchie tříd (Osoba -> Zamestnanec -> Admin)
├── requirements.txt        # Seznam závislostí pro instalaci prostředí
├── venv/                   # Virtuální prostředí Pythonu
├── __pycache__/            # Prekompilované soubory
├── zalohy_databaze/        # Automatické/manuální bezpečnostní zálohy SQLite
├── templates/
│   └── index.html          # Hlavní a jediný HTML dokument (Single Page Application)
└── static/
    ├── obrazky/
    │   ├── loga/           # Zákaznická loga pro exporty
    │   ├── tapety/         # Pozadí terminálu
    │   └── ikony/          # Favicon
    ├── styly/
    │   └── style.css       # Kompletní vizuální stylizace aplikace
    └── skripty/
        ├── admin.js        # Logika administrace, UI přepínání, RBAC oprávnění, exporty
        ├── data.js         # Globální stavové proměnné, prvotní načítání z backendu
        ├── terminal.js     # Chování terminálu, hodiny, rozvrh, zachytávání RFID vstupu
        └── modaly.js       # Logika vyskakovacích oken (numpad, login, seznam přítomných)
```

### Popis JavaScriptových souborů
Frontend aplikace je rozdělen do logických celků pro lepší udržitelnost:
* **`admin.js`:** Obsluhuje veškeré požadavky v administraci. Stará se o vykreslování tabulek, aplikaci filtrů, odesílání dat přes API (přidávání zaměstnanců, změny nastavení) a generování XLSX reportů pomocí knihovny ExcelJS.
* **`data.js`:** Slouží jako datový slovník. Spouští asynchronní HTTP požadavky na backend při startu aplikace a ukládá data do paměti prohlížeče pro rychlou odezvu terminálu.
* **`terminal.js`:** Srdce klientské části na terminálu. Řeší zachytávání kláves (wedge vstup z RFID čtečky s detekcí rychlosti úderů), odpočty pro spořič obrazovky a timeouty zvolených akcí. Integruje logiku pro zavírání notifikací gestem potažení (swipe-to-dismiss).
* **`modaly.js`:** Oddělená logika pro virtuální klávesnici (zadávání PINu) a přihlašovací obrazovku správce.

---

## Funkční specifikace

### Terminál docházky (Pro běžné zaměstnance)
* **Záznam akcí:** Možnost zvolit Příchod, Odchod, Lékař, Pauza. Barvy tlačítek respektují semaforovou psychologii (Zelená = Příchod, Červená = Odchod).
* **Ošetření chyb a výjimek:** Systém brání duplicitním záznamům (nelze zadat příchod dvakrát po sobě). Chybové a potvrzovací zprávy jsou řešeny formou "toast" notifikací.
* **Identifikace:** Primárně pomocí RFID čipu. V případě zapomenutí čipu se lze přihlásit pomocí osobního 4místného PIN kódu přes virtuální klávesnici.
* **Funkce "Vrátit zpět":** Pokud se zaměstnanec splete, interaktivní bublina mu nabízí dočasnou možnost svůj poslední záznam stornovat.
* **Harmonogram a spořič:** Terminál zobrazuje aktuální vyučovací hodinu nebo přestávku (konfigurovatelné). Po určité době nečinnosti přechází do tmavého režimu se spořičem obrazovky.

### Administrativní rozhraní
Přístup do administrace je možný přímo z terminálu (kliknutím na ikonu a zadáním oprávněného PINu/čipu), nebo standardně přes prohlížeč zadáním adresy (např. `dochazka.zakladniskola.cz`). Přístup přes web je chráněný přihlášením pomocí uživatelského jména a hesla.
Je využíván systém relací (sessions) s automatickým odhlášením při nečinnosti.

**Hierarchie oprávnění (RBAC):**
1.  **Administrátor / Ředitel:** Plný přístup do všech sekcí.
2.  **Zástupce:** Přístup do sekce "Exporty a logy" a "Správa zaměstnanců" (nemá přístup k nastavení systému).
3.  **Oprávněný zaměstnanec:** Vidí pouze sekci "Exporty a logy".

#### Sekce administrace
* **Exporty a logy:** Prohlížení chronologicky seřazené docházky. Rozšířené filtry (datum od-do, hledání dle jména). Generování výstupů do formátu XLSX s vloženým logem školy. Zobrazení logů přístupů administrátorů (auditní stopa s barevným odlišením neúspěšných pokusů). Zobrazení aktuálního počtu zaměstnanců ve škole.
* **Správa zaměstnanců:** Kompletní CRUD operace (Vytvoření, Čtení, Úprava, Smazání) nad záznamy zaměstnanců. Validace povinných polí, generování přehledové tabulky zaměstnanců do XLSX.
* **Nastavení (Pouze pro nejvyšší úroveň oprávnění):**
    * *Organizace:* Základní kontaktní údaje.
    * *Zálohování:* Nastavení periodicity záloh SQLite databáze.
    * *GDPR:* Pravidla retence dat (automatické mazání záznamů starších než 1 nebo 3 roky).
    * *Vzhled:* Upload tapet a zákaznických logotypů.
    * *Chování:* Nastavení časování spořiče, automatické odhlašování zapomenutých odchodů úderem půlnoci. Z této sekce lze též restartovat nebo trvale vypnout server.
    * *Harmonogram:* Editor vyučovacích hodin a přestávek propsaný do terminálu.
    * *Práva:* Povyšování běžných zaměstnanců na administrátory.
* **Tovární nastavení:** Kritická funkce chráněná nutností opsat slovo "RESTARTOVAT" a ověřit identitu heslem. Odstraní veškerá data a uvede systém do stavu před instalací.

## Instalace a spuštění

Systém je koncipován tak, aby jeho zprovoznění bylo co nejjednodušší.

1. Ujistěte se, že máte nainstalovaný Python 3.10+.

2. Ve složce projektu vytvořte virtuální prostředí a aktivujte jej (zde pro Linux/Mac OS):

```bash
source venv/bin/activate
```

4. Nainstalujte požadované knihovny ze souboru:

```bash
pip install -r requirements.txt
```

4. Spusťte aplikační server:

```bash
python app.py
```

5. Otevřete webový prohlížeč a přejděte na adresu:

   * `http://localhost:559`
   * nebo `http://127.0.0.1:559`

   (Aplikace je pro zamezení kolizí s jinými službami nastavena na port 559.)

6. Při zcela prvním spuštění (čistá databáze) systém automaticky přesměruje uživatele do průvodce nastavením (`/setup`), kde je vytvořen účet hlavního správce a nastavena základní konfigurace terminálu.
