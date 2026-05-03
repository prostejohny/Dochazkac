# Semestrální práce: Docházkáč 1.0

**Předmět:** Algoritmizace a programování 2

## Úvod a motivace
Docházkáč 1.0 je komplexní hardwarově-softwarové řešení docházkového systému, vyvinuté primárně pro potřeby Základní školy ve Štětí (s budoucím plánovaným nasazením i na ZŠ v Mostě). 

Při analýze trhu s docházkovými systémy pro školní prostředí byly zjištěny zásadní nedostatky komerčních řešení: vysoká pořizovací cena, nutnost platit pravidelné měsíční poplatky, absence české lokalizace, zastaralé uživatelské rozhraní a takřka nulová možnost přizpůsobení specifickým potřebám školy. Výsledkem této analýzy je vlastní systém, který je moderní, plně responzivní, navržený jako webová aplikace a nezávislý na drahém proprietárním hardwaru.

## Hardwarové řešení
Díky webové architektuře je aplikace nezávislá na platformě, nicméně referenční hardwarový terminál byl sestaven z následujících komponent:
* **Zobrazovač:** 10.1" dotykový displej Waveshare HMI (RPI-HMI-101D-ACCE-EU).
* **Výpočetní jednotka:** Raspberry Pi 5 (4GB RAM) integrované v displeji.
* **Napájení:** PoE (Power over Ethernet) ze stávající síťové infrastruktury (switch).
* **Periferie:** RFID čtečka (13.56 MHz) pracující v režimu emulace klávesnice. Tento standard byl zvolen pro zpětnou kompatibilitu se stávajícími čipy školní jídelny a budoucím napojením na tiskárny a elektronické zámky dveří.
* **Hostování serveru:** Aplikace běží na školním NAS serveru v izolované síti (VLAN VEDENÍ), bez přímého přístupu do veřejné sítě internet.

---

## Architektura softwaru a mapování na sylabus předmětu
Zdrojové kódy v jazyce Python jsou bohatě komentovány a rozděleny tak, aby plně demonstrovaly znalosti požadované v sylabu předmětu Algoritmizace a programování 2.

### `tridy.py` (Objektový model a dědičnost)
* **Bod 1, 12, 13:** Soubor obsahuje implementaci vlastních tříd, využití konstruktorů a metod. Je zde ukázkově využita dědičnost (Abstraktní základní třída `Osoba`, ze které dědí `Zamestnanec`, a z něj následně `Admin`). Demonstrace polymorfismu a efektivní recyklace kódu. Bezpečnost dat je zajištěna tím, že třídy pro zaměstnance uchovávají pouze hashe hesel, čipů a PINů (využití `werkzeug.security`).

### `struktury.py` (Vlastní datové struktury a algoritmy)
* **Bod 2, 6, 7, 11:** Plnohodnotná implementace jednosměrného spojového seznamu (`HistorieDochazky`) sloužícího jako struktura pro ukládání logů (nové záznamy se vkládají na hlavu - časová složitost O(1)).
* **Bod 3, 4, 5, 6, 8:** Implementace Binárního vyhledávacího stromu (`BSTUzivatelu`) pro rychlé vyhledávání a správu zaměstnanců. Součástí jsou vlastní vyhledávací a řadící algoritmy (např. vlastní implementace algoritmu *Insertion Sort* pro seřazení vyfiltrovaných záznamů podle času).
* **Bod 10:** Využití modulu `typing.Protocol` pro definici rozhraní (`SpojovaStruktura`) a implementace iterátorů (`__iter__` využívající generátor `yield`), díky čemuž lze s vlastními strukturami pracovat pomocí standardních cyklů `for`.

### `app.py` (Hlavní aplikační logika)
* Srdce backendu napsané ve frameworku Flask. Zajišťuje REST API, vícevláknové zpracování (na pozadí běží vlákna pro automatické odhlašování a automatické zálohy SQLite databáze), práci s databází a správu webových relací (sessions). Obsahuje vlastní bezpečnostní dekorátory pro ochranu API koncových bodů.

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
Přístup do administrace je možný přímo z terminálu (kliknutím na ikonu a zadáním oprávněného PINu/čipu), nebo standardně přes prohlížeč zadáním adresy (např. `dochazka.zssteti-skolni.cz`). Webový přístup podléhá přihlášení jménem a heslem.
Je využíván systém relací (sessions) s automatickým odhlášením při nečinnosti.

**Hierarchie oprávnění (RBAC):**
1.  **Administrátor / Ředitel:** Plný přístup do všech sekcí.
2.  **Zástupce:** Přístup do sekce "Exporty a logy" a "Správa zaměstnanců" (nemá přístup k nastavení systému).
3.  **Oprávněný zaměstnanec:** Vidí pouze sekci "Exporty a logy".

#### Sekce administrace
* **Exporty a logy:** Prohlížení chronologicky seřazené docházky. Rozšířené filtry (datum od-do, hledání dle jména). Generování výstupů do formátu XLSX s vloženým logem školy. Zobrazení logů přístupů administrátorů (auditní stopa s barevným odlišením neúspěšných pokusů).
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

1.  Ujistěte se, že máte nainstalovaný Python 3.10+.
2.  Ve složce projektu vytvořte virtuální prostředí a aktivujte jej.
3.  Nainstalujte závislosti ze souboru:
    ```bash
    pip install -r requirements.txt
    ```
4.  Spusťte aplikační server:
    ```bash
    python app.py
    ```
5.  Při zcela prvním spuštění (čistá databáze) systém automaticky přesměruje uživatele do průvodce nastavením (`/setup`), kde je vytvořen účet hlavního správce a nastavena základní konfigurace terminálu.
