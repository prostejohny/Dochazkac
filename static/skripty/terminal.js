// =====================================================================
// HODINY A ROZVRH
// =====================================================================

/**
 * Aktualizuje zobrazení hodin, času spořiče a data na terminálu.
 * Volá se každou sekundu přes setInterval.
 * Datum kapitalizuje první písmeno (toLocaleDateString vrací malé).
 */
function aktualizujHodiny() {
  const nyni = new Date();
  document.getElementById('hodiny').innerText = nyni.toLocaleTimeString('cs-CZ');
  // Spořič zobrazuje čas pouze v formátu HH:MM (bez sekund)
  document.getElementById('screensaver-time').innerText = nyni.toLocaleTimeString('cs-CZ').split(':').slice(0, 2).join(':');
  const suroveDatum = nyni.toLocaleDateString('cs-CZ', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  document.getElementById('datum').innerText = suroveDatum.charAt(0).toUpperCase() + suroveDatum.slice(1);
}

/**
 * Aktualizuje popisek aktuální vyučovací hodiny nebo přestávky.
 * 
 * Pokud je globální aktivniRozvrh prázdný (např. po načtení stránky před
 * odpovědí serveru), pokusí se rozvrh načíst přímo z DOM tabulky v administraci.
 * 
 * Logika zobrazení:
 *   - Mimo pracovní den nebo mimo rozsah hodin → "Mimo pracovní dobu"
 *   - V rozsahu dne, ale mimo konkrétní hodinu  → "Přestávka"
 *   - Přímo v hodině                            → název hodiny z rozvrhu
 */
function aktualizujVyucovaciHodinu() {
    const nyni = new Date();
    const cas_minuty = nyni.getHours() * 60 + nyni.getMinutes();
    const den = nyni.getDay(); // 0 = neděle, 1 = pondělí ... 6 = sobota
    
    // Záložní načtení rozvrhu z DOM, pokud ještě nepřišel ze serveru
    if (aktivniRozvrh.length === 0) {
        const radky = document.querySelectorAll('#rozvrh-body tr');
        radky.forEach(radek => {
            const nazev = radek.querySelector('td:nth-child(1) input').value;
            const odCas = radek.querySelector('td:nth-child(2) input').value;
            const doCas = radek.querySelector('td:nth-child(3) input').value;
            if (odCas && doCas) {
                const [hOd, mOd] = odCas.split(':').map(Number);
                const [hDo, mDo] = doCas.split(':').map(Number);
                aktivniRozvrh.push({ nazev: nazev, odMin: hOd * 60 + mOd, doMin: hDo * 60 + mDo, text: nazev });
            }
        });
    }

    let textHodiny = "Mimo pracovní dobu";
    
    // Pracovní dny jsou konfigurovatelné v nastavení — nekontrolujeme natvrdo Po–Pá
    if (pracovniDny.includes(den) && aktivniRozvrh.length > 0) { 
        const zacatekDne = Math.min(...aktivniRozvrh.map(h => h.odMin));
        const konecDne = Math.max(...aktivniRozvrh.map(h => h.doMin));
        
        if (cas_minuty >= zacatekDne && cas_minuty < konecDne) {
            textHodiny = "Přestávka"; // Výchozí stav uvnitř dne
            const nalezenaHodina = aktivniRozvrh.find(h => cas_minuty >= h.odMin && cas_minuty < h.doMin);
            if (nalezenaHodina) textHodiny = nalezenaHodina.text;
        }
    }
    document.getElementById('vyucovaci-hodina').innerText = textHodiny;
}

// Hodiny se aktualizují každou sekundu, rozvrh stačí každou minutu
setInterval(aktualizujHodiny, 1000); aktualizujHodiny();
setInterval(aktualizujVyucovaciHodinu, 60000); aktualizujVyucovaciHodinu();


// =====================================================================
// TERMINÁL — VÝBĚR AKCE DOCHÁZKY
// =====================================================================

/**
 * Označí vybrané akční tlačítko (Příchod/Odchod/Lékař/Pauza) jako aktivní
 * a spustí odpočet pro jeho automatické zrušení po době DOBA_RESETU_AKCE.
 * 
 * Zobrazí toast jako výzvu (jeVyzva=true) — zůstane viditelný po celou dobu čekání.
 * Po vypršení se akce i aktivní stav tlačítka automaticky zruší.
 * 
 * @param {HTMLElement} element - Tlačítko, na které uživatel klikl
 * @param {string} akce - Název akce ('Příchod', 'Odchod', 'Lékař', 'Pauza')
 */
function vyberAkci(element, akce) {
  document.querySelectorAll('.btn-akce').forEach(b => b.classList.remove('active'));
  element.classList.add('active');
  vybranaAkce = akce;
  
  ukazToast(akce, '', 'Nyní přiložte čip nebo zadejte PIN', akceConf[akce].color, akceConf[akce].bar, null, true);
  
  clearTimeout(resetAkceTimer);
  resetAkceTimer = setTimeout(() => {
      vybranaAkce = '';
      document.querySelectorAll('.btn-akce').forEach(b => b.classList.remove('active'));
      document.getElementById('notifikace').classList.remove('show');
  }, DOBA_RESETU_AKCE);

  document.getElementById('rfid-input').focus();
}


// =====================================================================
// ČTEČKA RFID ČIPŮ — ZACHYTÁVÁNÍ KLÁVES
// =====================================================================

const rfidInput = document.getElementById('rfid-input');
let rfidBuffer = '';         // Průběžně sestavovaný kód čipu z příchozích znaků
let lastKeyTime = Date.now(); // Čas posledního stisku klávesy (detekce pauzy mezi znaky)
const MAX_KEY_DELAY = 1000;  // Prodleva v ms, po které považujeme vstup za nový čip
let rfidTimeout;             // Časovač pro zpracování bufferu po skončení vstupu

/**
 * Globální posluchač kláves — rozlišuje vstup z RFID čtečky od běžného psaní.
 * 
 * Jak funguje detekce čipu:
 *   RFID čtečka posílá znaky rychle za sebou (< MAX_KEY_DELAY ms mezi znaky).
 *   Pokud přijde mezera > MAX_KEY_DELAY ms, buffer se resetuje — jde o nový čip.
 *   Po skončení vstupu (300ms ticho) se buffer odešle k ověření, pokud má ≥ 3 znaky.
 *   Čip lze odeslat i klávesou Enter (čtečky ji posílají na konci).
 * 
 * Klávesové zkratky numpadu (Backspace, Enter, Escape) fungují pouze pokud
 * je numpad otevřený a uživatel nepíše do jiného inputu.
 */
document.addEventListener('keydown', (e) => {
  resetSporic(); // Jakákoli klávesa resetuje spořič obrazovky
  const now = Date.now();
  const timeDiff = now - lastKeyTime;
  lastKeyTime = now;

  // Stav UI — určuje, jak budeme klávesy interpretovat
  const adminZobrazen = document.getElementById('admin-view').style.display === 'block';
  const wizardZobrazen = document.getElementById('wizard-view').style.display === 'flex';
  const modalOtevren = document.getElementById('numpad-modal').classList.contains('show');
  const loginOtevren = document.getElementById('admin-login-modal')?.classList.contains('show');
  const pritomniOtevren = document.getElementById('pritomni-modal')?.classList.contains('show');
  const isInputActive = document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA';

  // Vstup zpracujeme pouze pokud není aktivní jiný textový input (nebo jde o RFID input)
  if (!isInputActive || document.activeElement.id === 'rfid-input') {
      if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
          // Příliš dlouhá pauza = nový čip, resetujeme buffer
          if (timeDiff > MAX_KEY_DELAY) rfidBuffer = ''; 
          rfidBuffer += e.key;

          // Pokud je otevřený numpad a jde o číslici po pauze, přidáme ji do PINu
          if (modalOtevren && timeDiff > MAX_KEY_DELAY) {
              if (e.key >= '0' && e.key <= '9') {
                  e.preventDefault(); pridejCislo(e.key);
              }
          }

          // Po 300ms tichu vyhodnotíme buffer — čtečka už poslala vše
          clearTimeout(rfidTimeout);
          rfidTimeout = setTimeout(() => {
              if (rfidBuffer.length >= 3) {
                  let kodCipu = rfidBuffer;
                  rfidBuffer = ''; 
                  if (modalOtevren) zavriNumpad(); 
                  skrytSporic();
                  if (rfidInput) rfidInput.value = ''; 
                  zpracujIdentifikaci(kodCipu, 'cip'); 
              } else {
                  rfidBuffer = ''; // Příliš krátký vstup — ignorujeme
              }
          }, 300); 
          return;
      }
      else if (e.key === 'Enter') {
          // Čtečky často posílají Enter na konci — zpracujeme buffer okamžitě
          if (rfidBuffer.length >= 2) {
              e.preventDefault();
              clearTimeout(rfidTimeout);
              let kodCipu = rfidBuffer;
              rfidBuffer = ''; 
              if (modalOtevren) zavriNumpad(); 
              skrytSporic();
              if (rfidInput) rfidInput.value = ''; 
              zpracujIdentifikaci(kodCipu, 'cip'); 
              return;
          }
          rfidBuffer = '';
      }
  }

  // Pokud je otevřená administrace nebo průvodce, ignorujeme zbytek zkratek
  if (adminZobrazen || wizardZobrazen) return;
  if (loginOtevren) { if (e.key === 'Escape') zavriAdminLogin(); return; }
  if (pritomniOtevren && e.key === 'Escape') { zavriPritomne(); return; }

  // Klávesové zkratky pro numpad (fungují jen pokud je otevřený)
  if (modalOtevren) {
      if (e.key === 'Backspace') { e.preventDefault(); smazPin(); } 
      else if (e.key === 'Enter') { e.preventDefault(); potvrditPin(); } 
      else if (e.key === 'Escape') { e.preventDefault(); zavriNumpad(); }
      return;
  }

  // Jakákoli jiná klávesa mimo inputy vrátí focus na RFID pole a scrolluje nahoru
  const jeUndoTlacitko = e.target.id === 'toast-undo-btn';
  if (!isInputActive && !jeUndoTlacitko) {
      window.scrollTo(0, 0);
      rfidInput.focus();
  }
});


// =====================================================================
// ZPRACOVÁNÍ IDENTIFIKACE (ČIPEM I PINEM)
// =====================================================================

/**
 * Odešle kód čipu nebo PIN na server k ověření a zpracuje výsledek.
 * 
 * Možné výsledky:
 *   1. Neúspěch → zobrazí chybový toast
 *   2. Úspěch v admin režimu → zaznamená přístup a otevře administraci
 *      (nebo zobrazí "Přístup odepřen" pro neprivilegované role)
 *   3. Úspěch v docházkovém režimu → zapíše akci, zobrazí uvítací toast
 *      s tlačítkem "Vrátit zpět" pro opravu omylu
 * 
 * @param {string} kod - Kód čipu nebo zadaný PIN
 * @param {string} typ - 'cip' nebo 'pin'
 */
async function zpracujIdentifikaci(kod, typ) {
  kod = kod ? kod.toString().trim() : '';
  if (!kod) return;

  try {
      const response = await fetch('/api/overit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ kod: kod, typ: typ, akce: vybranaAkce })
      });
      const vysledek = await response.json();

      if (!vysledek.uspech) {
          ukazToast('Chyba', '', vysledek.chyba || 'Neznámý čip nebo PIN', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
          return;
      }

      // Větev pro přihlašování do administrace přes terminál (čipem nebo PINem)
      if (numpadRezim === 'admin') {
        numpadRezim = '';
        if (vysledek.je_admin || vysledek.role === 'Reditel' || vysledek.role === 'Administrator' || vysledek.role === 'Zastupce') {
            // await zajistí, že log se uloží PŘED otevřením administrace
            await zaznamenejAdminLogin(vysledek.uzivatel_jmeno, typ === 'cip' ? 'Čip' : 'PIN z terminálu', true);
            
            // Relace z terminálu platí 90 sekund (kratší než webová)
            const expirace = Date.now() + (90 * 1000);
            localStorage.setItem('adminSess', JSON.stringify({ jmeno: vysledek.uzivatel_jmeno, role: vysledek.role, expires: expirace, typ: 'terminal' }));
            
            otevriAdmin();
        } else {
            // Uživatel byl ověřen, ale nemá oprávnění pro administraci
            await zaznamenejAdminLogin(vysledek.uzivatel_jmeno, typ === 'cip' ? 'Čip' : 'PIN z terminálu', false);
            ukazToast('Přístup odepřen', vysledek.uzivatel_jmeno, 'K této sekci nemáte oprávnění.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        }
        return;
      }

      // Uživatel přiložil čip/PIN bez předchozího výběru akce
      if (!vybranaAkce) {
        ukazToast('Chyba', vysledek.uzivatel_jmeno, 'Nejdříve stiskněte tlačítko akce (Příchod/Odchod...)', 'var(--accent-yellow)', 'rgba(245, 158, 11, 0.6)');
        return;
      }

      // Načteme čerstvé logy — id_zaznamu potřebujeme pro tlačítko "Vrátit zpět"
      const logId = vysledek.id_zaznamu;
      await nactiLogyZBackendu();

      // Sestavíme zprávu — hlaska zaměstnance má přednost před výchozím textem
      let msg = '';
      if (vybranaAkce === 'Příchod') msg = vysledek.hlaska_prichod?.trim() || `Vítejte, ${vysledek.uzivatel_jmeno}!`;
      else if (vybranaAkce === 'Odchod') msg = vysledek.hlaska_odchod?.trim() || `Tak snad zase příště, ${vysledek.uzivatel_jmeno}.`;
      else msg = 'Zaznamenáno.';

      const cfg = akceConf[vybranaAkce] || akceConf['Příchod'];
      ukazToast(vybranaAkce, vysledek.uzivatel_jmeno, msg, cfg.color, cfg.bar, logId);

      // Pokud je administrace otevřená, aktualizujeme tabulku okamžitě
      if (document.getElementById('admin-view').style.display === 'block') {
          vykresliTabulkuLogu();
      }

      // Reset stavu terminálu po úspěšném záznamu
      vybranaAkce = '';
      document.querySelectorAll('.btn-akce').forEach(b => b.classList.remove('active'));
      clearTimeout(resetAkceTimer);

  } catch (error) {
      console.error("Spojení s Pythonem selhalo:", error);
      ukazToast('Chyba serveru', '', 'Nelze se spojit s databází.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
  }
}


// =====================================================================
// TOAST NOTIFIKACE
// =====================================================================

let toastTmr; // Časovač automatického skrytí toastu

/**
 * Zobrazí notifikační toast s výsledkem akce.
 * 
 * Toast se vytváří dynamicky pouze jednou — při dalším volání se jen aktualizuje obsah.
 * Tlačítko "Vrátit zpět" se zobrazí pouze pokud je předáno idZaznamu.
 * 
 * void bar.offsetWidth je záměrný — vynutí překreslení DOM, aby se CSS animace
 * správně restartovala i při opakovaném volání.
 * 
 * @param {string} action   - Nadpis toastu (název akce nebo 'Chyba')
 * @param {string} name     - Jméno zaměstnance (prázdný string = skryje se)
 * @param {string} msg      - Hlavní text zprávy
 * @param {string} color    - CSS barva pro nadpis
 * @param {string} barColor - CSS barva pro progress bar
 * @param {number|null} idZaznamu - ID záznamu pro tlačítko "Vrátit zpět" (null = skryje se)
 * @param {boolean} jeVyzva - true = toast zobrazíme 30s (čekáme na čip), false = 3.5s
 */
function ukazToast(action, name, msg, color, barColor, idZaznamu = null, jeVyzva = false) {
  document.getElementById('toast-action').textContent = action;
  document.getElementById('toast-action').style.color = color;
  
  if(name) {
      document.getElementById('toast-name').style.display = 'block';
      document.getElementById('toast-name').textContent = name;
  } else {
      document.getElementById('toast-name').style.display = 'none';
  }
  document.getElementById('toast-msg').textContent = msg;

  // Tlačítko "Vrátit zpět" vytvoříme pouze při prvním volání, pak ho jen aktualizujeme
  let undoBtn = document.getElementById('toast-undo-btn');
  if (!undoBtn) {
      undoBtn = document.createElement('button');
      undoBtn.id = 'toast-undo-btn';
      undoBtn.style.marginTop = '15px'; undoBtn.style.padding = '10px 15px';
      undoBtn.style.background = 'rgba(0,0,0,0.05)'; undoBtn.style.border = '1px solid rgba(0,0,0,0.1)';
      undoBtn.style.borderRadius = '12px'; undoBtn.style.cursor = 'pointer';
      undoBtn.style.fontWeight = 'bold'; undoBtn.style.color = 'var(--text-muted)';
      undoBtn.style.width = '100%'; undoBtn.style.fontSize = '1rem';
      undoBtn.style.transition = 'background 0.2s';
      undoBtn.onmouseover = () => undoBtn.style.background = 'rgba(0,0,0,0.1)';
      undoBtn.onmouseout = () => undoBtn.style.background = 'rgba(0,0,0,0.05)';
      const toastInner = document.querySelector('.toast-inner');
      const toastBar = document.querySelector('.toast-bar');
      toastInner.insertBefore(undoBtn, toastBar);
  }

  if (idZaznamu) {
      undoBtn.style.display = 'block';
      undoBtn.textContent = '↩ Vrátit zpět (Omyl)';
      undoBtn.onclick = () => zrusitAkci(idZaznamu);
  } else {
      undoBtn.style.display = 'none';
  }

  const bar = document.getElementById('toast-bar-fill');
  bar.style.background = barColor;
  bar.style.animation = 'none'; void bar.offsetWidth; // Restart CSS animace
  const dobaZobrazeni = jeVyzva ? 30000 : 3500;
  bar.style.animation = `drain ${dobaZobrazeni / 1000}s linear forwards`; 
  
  const el = document.getElementById('notifikace');
  el.classList.remove('show'); void el.offsetWidth; el.classList.add('show'); // Restart animace zobrazení
  clearTimeout(toastTmr);
  toastTmr = setTimeout(() => el.classList.remove('show'), dobaZobrazeni); 
}

/**
 * Smaže záznam docházky (funkce "Vrátit zpět / Omyl").
 * Skryje toast, odešle DELETE požadavek a po 300ms zobrazí potvrzení.
 * 
 * @param {number} idZaznamu - ID záznamu k smazání
 */
async function zrusitAkci(idZaznamu) {
    document.getElementById('notifikace').classList.remove('show');
    try {
        const response = await fetch(`/api/logy/smazat/${idZaznamu}`, { method: 'DELETE' });
        if (response.ok) {
            await nactiLogyZBackendu();
            vybranaAkce = '';
            document.querySelectorAll('.btn-akce').forEach(b => b.classList.remove('active'));
            clearTimeout(resetAkceTimer);
            setTimeout(() => {
                ukazToast('Zrušeno', '', 'Vaše akce byla smazána.', 'var(--accent-yellow)', 'rgba(245, 158, 11, 0.6)');
            }, 300);
        }
    } catch (e) { console.error("Chyba při rušení akce:", e); }
}


// =====================================================================
// SPOŘIČ OBRAZOVKY
// =====================================================================

let sporicTimer;                           // Časovač spuštění spořiče
let throttleTimer;                         // Throttle — omezuje frekvenci volání resetSporic
let DOBA_NECINNOSTI_PRO_SPORIC = 60000;   // Výchozí 60s, přepisuje se z nastavení

/**
 * Resetuje odpočet spořiče při jakékoli aktivitě uživatele.
 * Throttlování na 500ms zabraňuje zbytečnému volání při každém pohybu myši.
 */
function resetSporic() {
  if (throttleTimer) return; // Ještě jsme v throttle okně — přeskočíme
  throttleTimer = setTimeout(() => { throttleTimer = null; }, 500);
  skrytSporic();
  clearTimeout(sporicTimer);
  sporicTimer = setTimeout(ukazatSporic, DOBA_NECINNOSTI_PRO_SPORIC);
}

/**
 * Zobrazí spořič obrazovky, pokud není otevřená administrace nebo numpad.
 * Pokud ano, odpočet se zastaví — spořič se spustí až po jejich zavření.
 */
function ukazatSporic() {
  if (document.getElementById('admin-view').style.display === 'block' || 
      document.getElementById('numpad-modal').classList.contains('show') ||
      document.getElementById('admin-login-modal')?.classList.contains('show')) {
      clearTimeout(sporicTimer); return;
  }
  document.getElementById('screensaver').classList.add('active');
}

/**
 * Skryje spořič obrazovky a vrátí focus na RFID vstup.
 * Volá se při jakékoli interakci uživatele.
 */
function skrytSporic() {
  const screensaver = document.getElementById('screensaver');
  if (screensaver.classList.contains('active')) {
    screensaver.classList.remove('active');
    setTimeout(() => rfidInput.focus(), 100); 
  }
}

// Spořič se resetuje při pohybu myši, kliknutí i dotyku
['mousemove', 'mousedown', 'touchstart'].forEach(evt => {
  document.addEventListener(evt, resetSporic, true);
});
resetSporic(); // Spustíme odpočet hned při načtení stránky


// =====================================================================
// SWIPE TO DISMISS — Zavření toastu tažením nahoru (dotyk i myš)
// =====================================================================

const notifikaceEl = document.getElementById('notifikace');
let toastStartY = 0;      // Y souřadnice začátku tažení
let toastAktualniY = 0;   // Aktuální Y souřadnice při tažení
let jeToastTazen = false; // Příznak probíhajícího tažení

/**
 * Vrátí Y souřadnici události — sjednocuje rozhraní pro myš i dotyk.
 * @param {MouseEvent|TouchEvent} e
 */
function ziskejY(e) {
    return e.type.includes('touch') ? e.touches[0].clientY : e.clientY;
}

/**
 * Začátek tažení — zapamatujeme si startovní pozici a vypneme CSS přechody,
 * aby toast sledoval prst/kurzor okamžitě bez zpoždění animace.
 */
function startTazeni(e) {
    toastStartY = ziskejY(e);
    toastAktualniY = toastStartY;
    jeToastTazen = true;
    
    notifikaceEl.style.transition = 'none'; // Vypneme animaci pro přímé sledování
    notifikaceEl.style.cursor = 'grabbing'; 
}

/**
 * Průběh tažení — posouváme toast pouze nahoru (záporný posun).
 * Dolů tažení ignorujeme — toast nelze "rozbalit".
 */
function tazeni(e) {
    if (!jeToastTazen) return;
    
    toastAktualniY = ziskejY(e);
    let posunY = toastAktualniY - toastStartY;

    // Povolíme pouze tažení nahoru (záporné hodnoty)
    if (posunY < 0) {
        notifikaceEl.style.transform = `translate(-50%, ${posunY}px)`;
    }
}

/**
 * Konec tažení — rozhodneme, zda toast zahodit nebo vrátit na místo.
 * Práh pro zahození: 40px nahoru. Méně → toast se plynule vrátí.
 * 
 * Po zahození resetujeme stav terminálu (vybranaAkce, aktivní tlačítka).
 */
function konecTazeni() {
    if (!jeToastTazen) return;
    jeToastTazen = false;
    notifikaceEl.style.cursor = '';
    
    let celkovyPosun = toastAktualniY - toastStartY;

    notifikaceEl.style.transition = ''; // Zapneme animace zpět pro plynulý návrat/odjezd

    if (celkovyPosun < -40) {
        // Dostatečně potaženo nahoru — zahodíme toast
        notifikaceEl.classList.remove('show');
        notifikaceEl.style.transform = ''; 
        clearTimeout(toastTmr); 
        
        // Reset stavu terminálu — akce byla uživatelem vědomě zamítnuta
        vybranaAkce = '';
        document.querySelectorAll('.btn-akce').forEach(b => b.classList.remove('active'));
        clearTimeout(resetAkceTimer);
        
        if (typeof rfidInput !== 'undefined') rfidInput.focus();
    } else {
        // Nedostatečný tah — toast se plynule vrátí na původní místo
        notifikaceEl.style.transform = '';
    }
}

// Přiřazení událostí pro DOTYK (passive=true = neblokujeme scroll prohlížeče)
notifikaceEl.addEventListener('touchstart', startTazeni, { passive: true });
window.addEventListener('touchmove', tazeni, { passive: true });
window.addEventListener('touchend', konecTazeni);

// Přiřazení událostí pro MYŠ
notifikaceEl.addEventListener('mousedown', startTazeni);
window.addEventListener('mousemove', tazeni);
window.addEventListener('mouseup', konecTazeni);