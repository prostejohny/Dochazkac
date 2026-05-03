// =====================================================================
// NUMPAD MODAL — Zadávání PIN kódu
// =====================================================================

/**
 * Synchronizuje vizuální tečky numpadu s aktuálně zadaným PINem.
 * Vyplněné tečky odpovídají počtu zadaných číslic.
 */
function syncDots(){
  for(let i=0; i<4; i++){
    const d = document.getElementById(`dot-${i}`);
    zadanyPin.length > i ? d.classList.add('filled') : d.classList.remove('filled');
  }
}

// Časovač automatického zavření numpadu při nečinnosti
let numpadTimer;

/**
 * Restartuje odpočet 15 sekund pro automatické zavření numpadu.
 * Volá se při otevření a při každé interakci uživatele (stisk čísla, smazání).
 */
function resetNumpadTimer() {
  clearTimeout(numpadTimer);
  numpadTimer = setTimeout(() => {
    // Zavřeme okno pouze pokud je stále otevřené
    if (document.getElementById('numpad-modal').classList.contains('show')) {
      zavriNumpad();
    }
  }, 15000); // 15 000 ms = 15 sekund
}

/**
 * Otevře numpad v zadaném režimu.
 * @param {string} rezim - 'pin' pro docházku, 'admin' pro přístup do administrace
 */
function otevriNumpad(rezim) {
  if (rezim === 'admin') {
    // Při otevření v admin režimu zrušíme případně vybranou akci docházky
    vybranaAkce = '';
    document.querySelectorAll('.btn-akce').forEach(b => b.classList.remove('active'));
    document.getElementById('notifikace').classList.remove('show');
    clearTimeout(resetAkceTimer);
  }
  numpadRezim = rezim; zadanyPin = ''; syncDots();
  document.getElementById('numpad-titulek').innerText = rezim === 'admin' ? 'PIN administrátora' : 'Zadejte svůj PIN';
  document.activeElement.blur();
  document.getElementById('numpad-modal').classList.add('show');
  
  // Spustíme odpočet hned při otevření
  resetNumpadTimer();
}

/** Zavře numpad, vrátí focus na RFID vstup a vyčistí časovač nečinnosti. */
function zavriNumpad() { 
  document.getElementById('numpad-modal').classList.remove('show'); 
  rfidInput.focus(); 
  
  // Zastavíme časovač — nesmí běžet na pozadí po zavření
  clearTimeout(numpadTimer);
}

/** Přidá číslici k zadanému PINu (max 4 číslice) a prodlouží časovač nečinnosti. */
function pridejCislo(n) { 
  resetNumpadTimer(); // Uživatel je aktivní — dáme mu dalších 15 sekund
  if(zadanyPin.length >= 4) return; 
  zadanyPin += n.toString(); 
  syncDots(); 
}

/** Smaže poslední číslici PINu a prodlouží časovač nečinnosti. */
function smazPin() { 
  resetNumpadTimer(); // I mazání se počítá jako aktivita
  zadanyPin = zadanyPin.slice(0, -1); 
  syncDots(); 
}

/** Odešle zadaný PIN k ověření a zavře numpad (zavření vyčistí časovač). */
function potvrditPin() { 
  zpracujIdentifikaci(zadanyPin, 'pin'); 
  zavriNumpad();
}


// =====================================================================
// ADMIN LOGIN MODAL — Přihlášení přes webový formulář (pro PC)
// =====================================================================

/** Otevře přihlašovací okno správce, vyčistí pole a skryje předchozí chyby. */
function otevriAdminLogin() {
  document.getElementById('admin-login-modal').classList.add('show');
  document.getElementById('admin-user').value = '';
  document.getElementById('admin-pass').value = '';
  
  const errorDiv = document.getElementById('login-error');
  errorDiv.style.display = 'none';
  errorDiv.style.color = 'var(--accent-red)';
  
  document.getElementById('admin-user').focus();
}

/**
 * Zobrazí kontakt pro obnovu přístupu místo chybové hlášky.
 * Po 7 sekundách se informace automaticky skryje.
 */
function zapomenuteHeslo(e) {
  if (e) e.preventDefault(); 
  
  // Pokud je v nastavení e-mail, ukážeme ho — jinak obecný text
  const emailZobrazeni = (typeof kontaktniEmailAdmin !== 'undefined' && kontaktniEmailAdmin.trim() !== '') 
                         ? kontaktniEmailAdmin 
                         : 'vedení školy';

  const errorDiv = document.getElementById('login-error');
  
  // Přebarvíme div na modro — nejde o chybu, ale o informaci
  errorDiv.style.color = 'var(--accent-blue)';
  errorDiv.innerHTML = `Pro obnovu přístupu kontaktujte:<br><b style="font-size: 1.2rem; color: var(--text-main); display: inline-block; margin-top: 5px;">${emailZobrazeni}</b>`;
  errorDiv.style.display = 'block';

  // Po 7 sekundách schováme zprávu a vrátíme červenou barvu pro případné chyby
  setTimeout(() => {
    if (document.getElementById('admin-login-modal').classList.contains('show')) {
        errorDiv.style.display = 'none';
        errorDiv.style.color = 'var(--accent-red)';
    }
  }, 7000);
}

/**
 * Zavře přihlašovací okno správce.
 * @param {boolean} vynutit - true = zavře i na /admin stránce (kde je ESC blokované)
 */
function zavriAdminLogin(vynutit = false) {
  // V pure-admin-mode nelze okno zavřít bez vynucení — brání náhodné zavření přes ESC
  if (!vynutit && document.body.classList.contains('pure-admin-mode')) return; 
  
  document.getElementById('admin-login-modal').classList.remove('show');
  rfidInput.focus();
}


// =====================================================================
// OVĚŘENÍ PŘIHLAŠOVACÍCH ÚDAJŮ SPRÁVCE
// =====================================================================

/**
 * Odešle přihlašovací údaje na server a zpracuje výsledek.
 * 
 * Při úspěchu:
 *   - Zaznamená přihlášení do admin logů (await = čekáme na dokončení)
 *   - Uloží relaci do localStorage s expirací 3 minuty
 *   - Otevře administraci
 * 
 * Při neúspěchu zobrazí chybovou hlášku a zaznamená neúspěšný pokus.
 */
async function overitAdminLogin() {
  const loginInput = document.getElementById('admin-user').value.trim();
  const hesloInput = document.getElementById('admin-pass').value.trim();
  const errorDiv = document.getElementById('login-error');

  errorDiv.style.display = 'none';

  if (!loginInput || !hesloInput) {
    errorDiv.innerText = 'Vyplňte obě pole!';
    errorDiv.style.display = 'block';
    return;
  }

  try {
    const response = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ login: loginInput, heslo: hesloInput })
    });

    const vysledek = await response.json();

    if (response.ok && vysledek.uspech) {
      document.getElementById('admin-user').value = '';
      document.getElementById('admin-pass').value = '';
      zavriAdminLogin(true);
      
      // await zajistí, že log se uloží PŘED otevřením administrace
      await zaznamenejAdminLogin(vysledek.jmeno, 'Webové heslo', true);
      
      // Relace pro webové přihlášení platí 3 minuty
      const expirace = Date.now() + (3 * 60 * 1000);
      localStorage.setItem('adminSess', JSON.stringify({ jmeno: vysledek.jmeno, role: vysledek.role, expires: expirace, typ: 'web' }));
      
      otevriAdmin();
    } else {
      errorDiv.innerText = vysledek.chyba || 'Nesprávné jméno nebo heslo!';
      errorDiv.style.display = 'block';
      
      // Zaznamenáme i neúspěšný pokus pro audit log
      await zaznamenejAdminLogin(loginInput, 'Webové heslo', false);
    }
  } catch (e) {
    console.error("Chyba přihlášení:", e);
    errorDiv.innerText = 'Chyba při komunikaci se serverem.';
    errorDiv.style.display = 'block';
  }
}


// =====================================================================
// SPRÁVA RELACE SPRÁVCE (SESSION)
// =====================================================================

/**
 * Odhlásí správce — smaže relaci z localStorage i na serveru, zavře administraci.
 * Na stránce /admin automaticky znovu otevře přihlašovací okno.
 */
async function odhlasitAdmina() {
    localStorage.removeItem('adminSess');
    
    // Odhlásíme i serverovou session (Flask session cookie)
    try { await fetch('/api/admin/logout', { method: 'POST' }); } catch(e) { console.error("Odhlášení na serveru selhalo", e); }
    
    zavriAdmin(true);
    ukazToast('Odhlášeno', '', 'Byl/a jste úspěšně odhlášen/a.', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
    
    // Na vyhrazené /admin stránce ihned zobrazíme přihlašovací okno znovu
    if (document.body.classList.contains('pure-admin-mode')) {
        setTimeout(() => {
            otevriAdminLogin();
        }, 500);
    }
}

/**
 * Prodlouží platnost relace při aktivitě uživatele (kliknutí).
 * 
 * Pokud relace vypršela a administrace je otevřená, zavře ji
 * a zobrazí přihlašovací okno. Prodloužení závisí na typu přihlášení:
 *   - terminal: +90 sekund
 *   - web:      +5 minut
 */
function obnovAdminRelaci() {
    const ulozenaSess = localStorage.getItem('adminSess');
    if (ulozenaSess) {
        const dataSess = JSON.parse(ulozenaSess);
        
        if (Date.now() < dataSess.expires) {
            // Relace je platná — prodloužíme ji
            const prodlouzeni = dataSess.typ === 'terminal' ? (90 * 1000) : (5 * 60 * 1000);
            dataSess.expires = Date.now() + prodlouzeni;
            localStorage.setItem('adminSess', JSON.stringify(dataSess));
        } else {
            // Relace vypršela — uživatel klikl až po timeoutu
            localStorage.removeItem('adminSess'); 
            
            if (document.getElementById('admin-view').style.display === 'block') {
                zavriAdmin(true); 
                
                if ((dataSess.typ === 'web' || document.body.classList.contains('pure-admin-mode')) && typeof otevriAdminLogin === 'function') {
                    otevriAdminLogin();   
                }
                ukazToast('Odhlášeno', '', 'Z důvodu nečinnosti jste byl/a odhlášen/a.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
            }
        }
    }
}

/**
 * Hlídač relace — kontroluje každou sekundu, zda nevypršel čas.
 * 
 * Záchytná síť pro případ, že uživatel neklikne (obnovAdminRelaci se nespustí)
 * a administrace by zůstala viset otevřená donekonečna.
 */
setInterval(() => {
    const adminView = document.getElementById('admin-view');
    const ulozenaSess = localStorage.getItem('adminSess');
    
    if (adminView && adminView.style.display === 'block' && ulozenaSess) {
        const dataSess = JSON.parse(ulozenaSess);
        
        if (Date.now() > dataSess.expires) {
            // Čas vypršel a nikdo neklikl — zavřeme natvrdo
            localStorage.removeItem('adminSess');
            zavriAdmin(true); 
            
            if ((dataSess.typ === 'web' || document.body.classList.contains('pure-admin-mode')) && typeof otevriAdminLogin === 'function') {
                otevriAdminLogin();
            }
            
            ukazToast('Odhlášeno', '', 'Vypršel časový limit administrace.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        }
    }
}, 1000);


// =====================================================================
// SEZNAM PŘÍTOMNÝCH MODAL
// =====================================================================

/**
 * Zjistí, kteří zaměstnanci jsou aktuálně ve škole, a aktualizuje
 * jak počítadlo v záhlaví (stat-pritomni), tak obsah modálního okna.
 * 
 * Zaměstnanec je považován za přítomného, pokud jeho poslední
 * dnešní záznam má akci 'Příchod'.
 */
function aktualizujPritomne() {
  const dnesniDatum = fmtDate(new Date());
  let pocetPritomnych = 0;
  let seznamHtml = '';

  uzivatele.forEach(u => {
    // Backend posílá logy od nejnovějšího — první shoda je poslední záznam
    const posledniLog = logy.find(l => l.jmeno === u.jmeno && l.datumKratke === dnesniDatum);
    
    // Přítomný = poslední dnešní záznam je 'Příchod' (ne Odchod, Lékař ani Pauza)
    if (posledniLog && posledniLog.akce === 'Příchod') {
      pocetPritomnych++;
      seznamHtml += `
        <div class="pritomny-zaznam" style="padding: 12px 0; border-bottom: 1px solid rgba(0,0,0,0.05); display: flex; justify-content: space-between; align-items: center;">
          <strong class="pritomny-jmeno" style="color: var(--text-main);">${u.jmeno}</strong>
          <span style="color: var(--accent-green); font-size: 0.9em; font-weight: bold;">Příchod v ${posledniLog.cas}</span>
        </div>`;
    }
  });

  // Aktualizujeme počítadlo v záhlaví administrace
  const statPritomni = document.getElementById('stat-pritomni');
  if(statPritomni) {
      statPritomni.innerHTML = `
        <span>Aktuálně ve škole</span>
        <div class="stat-badge-number">${pocetPritomnych} / ${uzivatele.length}</div>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-blue); opacity: 0.7;"><path d="m9 18 6-6-6-6"></path></svg>
      `;
  }

  // Aktualizujeme obsah modálního okna (nebo zobrazíme prázdný stav)
  const obsahModalu = document.getElementById('seznam-pritomnych-obsah');
  if (obsahModalu) {
      obsahModalu.innerHTML = seznamHtml || '<div style="text-align:center; padding: 30px; color: var(--text-muted2);">Aktuálně není ve škole nikdo přihlášen.</div>';
  }
}

/** Otevře modální okno se seznamem přítomných a zaměří vyhledávací pole. */
function otevriPritomne() {
  document.getElementById('pritomni-modal').classList.add('show');
  const searchBox = document.getElementById('hledat-pritomne');
  if (searchBox) { searchBox.value = ''; filtrujPritomne(); setTimeout(() => searchBox.focus(), 100); }
}

/** Zavře modální okno se seznamem přítomných. */
function zavriPritomne() { 
    document.getElementById('pritomni-modal').classList.remove('show'); 
}

/**
 * Filtruje zobrazené záznamy v modálním okně podle textu ve vyhledávacím poli.
 * Porovnání probíhá bez ohledu na velikost písmen.
 */
function filtrujPritomne() {
  const text = document.getElementById('hledat-pritomne').value.toLowerCase().trim();
  const zaznamy = document.querySelectorAll('#seznam-pritomnych-obsah .pritomny-zaznam');
  zaznamy.forEach(zaznam => {
    const jmeno = zaznam.querySelector('.pritomny-jmeno').textContent.toLowerCase();
    zaznam.style.display = jmeno.includes(text) ? 'flex' : 'none';
  });
}