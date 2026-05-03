// =====================================================================
// GLOBÁLNÍ DATA A PROMĚNNÉ
// =====================================================================

// Rozvrh vyučovacích hodin — plní se ze serveru, prázdné pole = neznačteno
let aktivniRozvrh = [];

// Dnešní a včerejší datum jako objekty Date — používají se při výpočtech docházky
const dnes = new Date();
const vcera = new Date(dnes); vcera.setDate(vcera.getDate()-1);

// Pracovní dny jako čísla (0=neděle, 1=pondělí ... 6=sobota) — výchozí Po–Pá
// Přepisuje se hodnotou ze serveru při načtení nastavení
let pracovniDny = [1, 2, 3, 4, 5];

/**
 * Formátuje objekt Date do řetězce RRRR-MM-DD (ISO formát pro porovnávání s DB).
 * Používá se napříč celou aplikací všude, kde potřebujeme datum jako text.
 * @param {Date} d
 * @returns {string} např. '2024-09-02'
 */
const fmtDate = d => {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};

// Vzorové časy pro včerejší příchod a odchod — používají se v grafech a statistikách
let vR = new Date(vcera); vR.setHours(7,45,0);
let vO = new Date(vcera); vO.setHours(14,15,0);

// --- Datové zásobníky naplňované ze serveru ---
let uzivatele = [];                  // Seznam všech zaměstnanců (bez citlivých dat)
let kontaktniEmailAdmin = '';        // E-mail správce — zobrazuje se při zapomenutém hesle
let logy = [];                       // Záznamy docházky (od nejnovějšího)
let adminLogy = [];                  // Záznamy přístupů do administrace
let aktualniVyfiltrovanaData = [];   // Aktuálně zobrazená data v tabulce (po filtru/řazení)

// --- Stav terminálu ---
let vybranaAkce = '';        // Aktuálně vybraná akce ('Příchod', 'Odchod', 'Lékař', 'Pauza')
let numpadRezim = '';        // Režim numpadu ('pin' pro docházku, 'admin' pro administraci)
let zadanyPin = '';          // Průběžně zadávaný PIN v numpadu
let aktualniStrana = 1;      // Aktuální stránka v tabulce logů (stránkování)
let resetAkceTimer;          // Časovač automatického zrušení vybrané akce
const ZAZNAMU_NA_STRANU = 10; // Počet řádků na stránku v tabulkách administrace

// Doba (v ms) po které se vybraná akce automaticky zruší — přepisuje se z nastavení
let DOBA_RESETU_AKCE = 30000;


// =====================================================================
// POMOCNÉ FUNKCE — ROLE A KONFIGURACE AKCÍ
// =====================================================================

/**
 * Převede interní ID role na čitelný český název pro zobrazení v UI.
 * Interní ID jsou bez diakritiky kvůli kompatibilitě s DB a URL.
 * @param {string} roleId - Interní ID role (např. 'Ucitel')
 * @returns {string} Čitelný název (např. 'Učitel'), nebo 'Neznámá' pro neznámé ID
 */
function ziskejNazevRole(roleId) {
  const mapa = { 
      'Administrator': 'Administrátor', 
      'Reditel': 'Ředitel', 
      'Zastupce': 'Zástupce',
      'Ucitel': 'Učitel', 
      'Asistent': 'Asistent', 
      'Provozni': 'Provozní', 
      'Druzina': 'Družina' 
  };
  return mapa[roleId] || 'Neznámá';
}

/**
 * Konfigurace barev pro každý typ akce docházky.
 * color = barva nadpisu v toastu, bar = barva progress baru toastu.
 * Používá CSS proměnné definované v style.css.
 */
const akceConf = {
  'Příchod': {color: 'var(--accent-green)', bar: 'rgba(16, 185, 129, 0.6)'},
  'Odchod':  {color: 'var(--accent-red)',   bar: 'rgba(239, 68, 68, 0.6)'},
  'Lékař':   {color: 'var(--accent-blue)',  bar: 'rgba(59, 130, 246, 0.6)'},
  'Pauza':   {color: 'var(--accent-yellow)', bar: 'rgba(245, 158, 11, 0.6)'},
};


// =====================================================================
// KOMUNIKACE S BACKENDEM — API FETCH
// =====================================================================

/**
 * Stáhne seznam zaměstnanců ze serveru a uloží do globálního pole uzivatele.
 * Pokud je administrace otevřená, okamžitě překreslí obě tabulky zaměstnanců.
 * 
 * Parametr ?t=Date.now() zabraňuje cachování — zajistí čerstvá data po každé změně.
 */
async function nactiUzivateleZBackendu() {
    try {
        const response = await fetch('/api/uzivatele?t=' + Date.now());
        uzivatele = await response.json();
        
        if (document.getElementById('admin-view').style.display === 'block') {
            vykresliTabulkuUzivatelu();
            vykresliTabulkuAdminu();
        }
    } catch (error) {
        console.error("Chyba spojení se serverem:", error);
    }
}

/**
 * Stáhne záznamy docházky ze serveru a uloží do globálního pole logy.
 * Zároveň resetuje aktualniVyfiltrovanaData na plný seznam (bez aktivního filtru).
 * Pokud je administrace otevřená, překreslí tabulku logů a aktualizuje přítomné.
 * 
 * Parametr ?t=Date.now() zabraňuje cachování odpovědi prohlížečem.
 */
async function nactiLogyZBackendu() {
    try {
        const response = await fetch('/api/logy?t=' + Date.now());
        logy = await response.json();
        aktualniVyfiltrovanaData = [...logy]; // Spread = mělká kopie, neodkazujeme na stejné pole
        
        if (document.getElementById('admin-view').style.display === 'block') {
            vykresliTabulkuLogu();
            aktualizujPritomne();
        }
    } catch (error) {
        console.error("Chyba při stahování logů:", error);
    }
}

/**
 * Stáhne veškerá nastavení systému ze serveru a promítne je do UI.
 * 
 * Načítá se jako první při startu (před uzivateli a logy), protože
 * nastavení obsahuje tapetu, spořič a rozvrh — ty musí být viditelné okamžitě.
 * 
 * Každý klíč je ošetřen podmínkou — pokud není v DB uložen, input zůstane prázdný
 * a aplikace použije výchozí hodnotu proměnné.
 */
async function nactiNastaveniZBackendu() {
    try {
        const response = await fetch('/api/nastaveni');
        const data = await response.json();
        
        // --- Základní údaje organizace ---
        if (data['obecne_nazev']) document.getElementById('set-nazev').value = data['obecne_nazev'];
        if (data['obecne_ico']) document.getElementById('set-ico').value = data['obecne_ico'];
        if (data['obecne_tel']) document.getElementById('set-tel').value = data['obecne_tel'];
        
        // E-mail uložíme i do globální proměnné — používá ho funkce zapomenuteHeslo()
        if (data['obecne_email']) {
            kontaktniEmailAdmin = data['obecne_email']; 
            const emailInput = document.getElementById('set-kontakt-email');
            if (emailInput) emailInput.value = data['obecne_email'];
        }
        
        if (data['obecne_adresa']) {
            const adresaInput = document.getElementById('set-adresa');
            if (adresaInput) adresaInput.value = data['obecne_adresa'];
        }
        
        // --- GDPR — retenční lhůta záznamů ---
        if (data['gdpr_retence']) document.getElementById('set-retence').value = data['gdpr_retence'];
        
        // --- Terminál — spořič a reset akce ---
        if (data['term_sporic']) {
            document.getElementById('set-sporic').value = data['term_sporic'];
            if (typeof DOBA_NECINNOSTI_PRO_SPORIC !== 'undefined') {
                DOBA_NECINNOSTI_PRO_SPORIC = parseInt(data['term_sporic']) * 1000;
            }
            if (typeof resetSporic === 'function') resetSporic(); // Okamžitě promítne nový čas
        }
        if (data['term_reset']) {
            document.getElementById('set-reset').value = data['term_reset'];
            DOBA_RESETU_AKCE = parseInt(data['term_reset']) * 1000;
        }
        
        // --- Terminál — tapeta a automatický odchod ---
        if (data['term_tapeta']) {
            document.getElementById('set-tapeta').value = data['term_tapeta'];
            zmenitTapetu(data['term_tapeta'], false); // false = bez animace při načtení
        }
        
        if (data['term_auto_odchod']) {
            document.getElementById('set-auto-odchod').checked = data['term_auto_odchod'] === 'true';
        }

        // --- Rozvrh vyučovacích hodin ---
        if (data['rozvrh_data']) {
            aktivniRozvrh = JSON.parse(data['rozvrh_data']);
            aktualizujVyucovaciHodinu(); // Okamžitě zobrazíme správnou hodinu
        }

        // Pracovní dny — zaškrtneme i checkboxy v administraci, aby odpovídaly realitě
        if (data['rozvrh_dny']) {
            pracovniDny = JSON.parse(data['rozvrh_dny']);
            document.querySelectorAll('.pracovni-dny-grid input').forEach(cb => {
                cb.checked = pracovniDny.includes(parseInt(cb.value));
            });
        }

        // --- Automatické zálohování ---
        if (data['backup_path']) {
            const smbInput = document.getElementById('set-backup-path');
            if (smbInput) smbInput.value = data['backup_path'];
        }
        
        if (data['zaloha_db_zapnuto']) {
            const dbSwitch = document.getElementById('set-zaloha-db');
            if (dbSwitch) dbSwitch.checked = data['zaloha_db_zapnuto'] === 'true';
        }
        
        if (data['zaloha_frekvence']) {
            const frekvenceSelect = document.getElementById('set-zaloha-frekvence');
            if (frekvenceSelect) frekvenceSelect.value = data['zaloha_frekvence'];
        }

        // --- Export — aktivní logo ---
        if (data['export_logo']) {
            aktivniLogoExportu = data['export_logo'];
            const selectLogo = document.getElementById('set-logo');
            if (selectLogo) selectLogo.value = aktivniLogoExportu;
        }
        
    } catch (e) {
        console.error("Chyba při načítání nastavení:", e);
    }
}


// =====================================================================
// INICIALIZACE PO NAČTENÍ STRÁNKY
// =====================================================================

/**
 * Spustí načítání dat až po plném načtení DOM a všech ostatních skriptů.
 * 
 * Pořadí je záměrné:
 *   1. nastaveni — tapeta a spořič musí být viditelné co nejdříve
 *   2. uzivatele + logy — načtou se paralelně po dokončení nastavení
 */
window.addEventListener('DOMContentLoaded', () => {
    nactiNastaveniZBackendu().then(() => {
        nactiUzivateleZBackendu();
        nactiLogyZBackendu();
    });
});