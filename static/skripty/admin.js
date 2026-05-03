// =====================================================================
// POMOCNÉ FUNKCE
// =====================================================================

/**
 * Escapuje speciální HTML znaky v řetězci — ochrana proti XSS útokům.
 * Volá se vždy před vložením uživatelského textu do innerHTML.
 * @param {string} str - Vstupní řetězec (může být null/undefined)
 * @returns {string} Bezpečný řetězec pro vložení do HTML
 */
function esc(str) {
    if (!str) return "";
    return String(str).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}


// =====================================================================
// PŘEPÍNÁNÍ ADMIN ROZHRANÍ — Otevření, zavření, záložky
// =====================================================================

/**
 * Otevře administraci — skryje terminál, zobrazí admin panel.
 * 
 * Před zobrazením nastaví viditelnost záložek podle role přihlášeného správce:
 *   - Administrator / Reditel → plná práva (vidí vše)
 *   - Zastupce               → vidí Export a Správu, NEVIDÍ Nastavení
 *   - ostatní role           → vidí pouze Export
 * 
 * Poté stáhne čerstvá data ze serveru a vyčistí všechny filtry a formuláře,
 * aby administrace vždy začínala v čistém stavu.
 */
async function otevriAdmin() {
  document.getElementById('terminal-view').style.display = 'none';
  document.getElementById('admin-view').style.display = 'block';
  
  // --- ROZŠÍŘENÁ LOGIKA OPRÁVNĚNÍ (3 ÚROVNĚ) ---
  const ulozenaSess = localStorage.getItem('adminSess');
  let role = '';
  
  if (ulozenaSess) {
      const dataSess = JSON.parse(ulozenaSess);
      role = dataSess.role;
  }

  // Najdeme tlačítka navigace pomocí jejich onclick atributů
  const btnExport = document.querySelector("button[onclick*='tab-export']");
  const btnSprava = document.querySelector("button[onclick*='tab-sprava']");
  const btnNastaveni = document.querySelector("button[onclick*='tab-admini']");

  if (role === 'Administrator' || role === 'Reditel') {
      // Úroveň 1: Plná práva (vidí vše)
      if (btnSprava) btnSprava.style.display = '';
      if (btnNastaveni) btnNastaveni.style.display = '';
      
  } else if (role === 'Zastupce') {
      // Úroveň 2: Zástupce (vidí Export a Správu, NEVIDÍ Nastavení)
      if (btnSprava) btnSprava.style.display = '';
      if (btnNastaveni) btnNastaveni.style.display = 'none';
      
      // Pokud by náhodou měl otevřené Nastavení z minula, hodíme ho na Export
      if (document.getElementById('tab-admini') && document.getElementById('tab-admini').style.display === 'block') {
          if (btnExport) prepniZalozku('tab-export', btnExport);
      }
      
  } else {
      // Úroveň 3: Ostatní správci (vidí JEN Export)
      if (btnSprava) btnSprava.style.display = 'none';
      if (btnNastaveni) btnNastaveni.style.display = 'none';
      
      // Vynutíme přepnutí na Export
      if (btnExport) prepniZalozku('tab-export', btnExport);
  }
  // -----------------------------
  
  // Stáhneme nejnovější data před zobrazením administrace (await = čekáme na dokončení)
  await nactiUzivateleZBackendu();
  await nactiLogyZBackendu();

  nactiAdminLogyZBackendu();
  
  // Načtení seznamu log a tapet ze serveru
  nactiSeznamLog();
  nactiSeznamTapet();
  
  aktualniAdminStrana = 1;
  
  // Vyčištění filtru zaměstnanců
  vyfiltrovaniUzivatele = null;
  aktualniStranaUzivatele = 1;
  const hledatInput = document.getElementById('hledat-zamestnance');
  if (hledatInput) hledatInput.value = '';
  
  // Úplné vyčištění formuláře pro přidání/úpravu zaměstnance
  if (typeof zrusitUpravu === 'function') zrusitUpravu();
  
  // Vyčištění filtru v historii docházky
  const hledatHistorie = document.getElementById('filter-user');
  if (hledatHistorie) hledatHistorie.value = '';
  const filterOd = document.getElementById('filter-od');
  if (filterOd) filterOd.value = '';
  const filterDo = document.getElementById('filter-do');
  if (filterDo) filterDo.value = '';
  
  // Vyčištění filtru v historii admin logů
  const adminOd = document.getElementById('admin-filter-od');
  if (adminOd) adminOd.value = '';
  const adminDo = document.getElementById('admin-filter-do');
  if (adminDo) adminDo.value = '';
  
  // Vždy stáhneme aktuální nastavení z databáze (přepíše neuložené úpravy)
  if (typeof nactiNastaveniZBackendu === 'function') nactiNastaveniZBackendu();
  
  aktualizujSelectZamestnancu();
  vykresliTabulkuUzivatelu();
  vykresliTabulkuAdminu(); 
  aktualizujPritomne();    
  aplikujFiltry(); 
  window.scrollTo(0, 0); 
}

/**
 * Přepne aktivní záložku v administraci a vyčistí filtry záložky, ze které odcházíme.
 * 
 * Při odchodu ze Správy → vyčistí filtr zaměstnanců a formulář
 * Při odchodu z Exportu  → vyčistí filtry logů a admin logů
 * Při odchodu z Nastavení → přenačte nastavení ze serveru (zahodí neuložené změny)
 * 
 * @param {string} idZalozky - ID elementu záložky (např. 'tab-export')
 * @param {HTMLElement} btn  - Tlačítko záložky, které se má označit jako aktivní
 */
function prepniZalozku(idZalozky, btn) {
  document.querySelectorAll('.tab-obsah').forEach(el => el.style.display = 'none');
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.getElementById(idZalozky).style.display = 'block';
  btn.classList.add('active');

  // Vyčištění filtru a formuláře zaměstnanců při přepnutí jinam
  if (idZalozky !== 'tab-sprava') {
    vyfiltrovaniUzivatele = null;
    aktualniStranaUzivatele = 1;
    const hledatInput = document.getElementById('hledat-zamestnance');
    if (hledatInput) hledatInput.value = '';
    if (typeof vykresliTabulkuUzivatelu === 'function') vykresliTabulkuUzivatelu();
    
    if (typeof zrusitUpravu === 'function') zrusitUpravu();
  }

  // Vyčištění filtru logů a admin logů při přepnutí jinam
  if (idZalozky !== 'tab-export') {
    const hledatHistorie = document.getElementById('filter-user');
    if (hledatHistorie) hledatHistorie.value = '';
    const filterOd = document.getElementById('filter-od');
    if (filterOd) filterOd.value = '';
    const filterDo = document.getElementById('filter-do');
    if (filterDo) filterDo.value = '';
    
    const adminOd = document.getElementById('admin-filter-od');
    if (adminOd) adminOd.value = '';
    const adminDo = document.getElementById('admin-filter-do');
    if (adminDo) adminDo.value = '';

    if (typeof aplikujFiltry === 'function') aplikujFiltry(); 
    if (typeof vykresliTabulkuAdminLogu === 'function') vykresliTabulkuAdminLogu(); 
  }

  // Zrušení neuložených změn na kartě Nastavení při odchodu z ní
  if (idZalozky !== 'tab-admini') {
      if (typeof nactiNastaveniZBackendu === 'function') nactiNastaveniZBackendu();
  }
}

/**
 * Zavře administraci a vrátí zobrazení na terminál.
 * 
 * @param {boolean} vynutit - true = zavře i na /admin stránce (kde je jinak zavření blokované)
 */
function zavriAdmin(vynutit = false) {
  // Pokud nevynucujeme zavření a jsme v čistém admin režimu, zablokujeme to
  if (!vynutit && document.body.classList.contains('pure-admin-mode')) return; 
  
  // Natvrdo schováme admin panel
  document.getElementById('admin-view').style.display = 'none';
  
  // Terminál ukážeme pouze tehdy, když NEJSME na adrese /admin
  if (!document.body.classList.contains('pure-admin-mode')) {
    document.getElementById('terminal-view').style.display = 'flex';
  }
  
  if (typeof rfidInput !== 'undefined') rfidInput.focus();
}


// =====================================================================
// LOGOVÁNÍ PŘÍSTUPŮ DO ADMINISTRACE
// =====================================================================

/**
 * Zapíše záznam o přihlášení (nebo pokusu o přihlášení) do admin logů.
 * 
 * Čas se formátuje s úvodními nulami (HH:MM:SS), aby textové řazení
 * v databázi fungovalo správně — bez nich by "9:00" bylo větší než "10:00".
 * 
 * Pokud je administrace zrovna otevřená, okamžitě obnoví tabulku logů.
 * 
 * @param {string} jmeno    - Jméno přihlašujícího se správce (nebo zadaný login)
 * @param {string} metoda   - Způsob přihlášení ('Webové heslo', 'Čip', 'PIN z terminálu')
 * @param {boolean} uspesne - true = úspěšné přihlášení, false = neúspěšný pokus
 */
async function zaznamenejAdminLogin(jmeno, metoda, uspesne = true) {
  const nyni = new Date();
  
  // Formát HH:MM:SS s úvodní nulou — důležité pro správné textové řazení v DB
  const formatovanyCas = String(nyni.getHours()).padStart(2, '0') + ':' + 
                         String(nyni.getMinutes()).padStart(2, '0') + ':' + 
                         String(nyni.getSeconds()).padStart(2, '0');

  const novyLog = { 
    id: nyni.getTime(), 
    datumKratke: fmtDate(nyni), 
    cas: formatovanyCas, 
    jmeno: jmeno, 
    metoda: metoda, 
    uspesne: uspesne 
  };
  
  try {
      await fetch('/api/admin/logy', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(novyLog)
      });
      // Pokud je administrace zrovna otevřená, rovnou ji aktualizujeme
      if (document.getElementById('admin-view').style.display === 'block') {
          nactiAdminLogyZBackendu();
      }
  } catch (e) { console.error("Nelze odeslat admin log", e); }
}

/**
 * Stáhne historii přístupů správců ze serveru a překreslí tabulku admin logů.
 * Parametr ?t= zabraňuje cachování odpovědi prohlížečem.
 */
async function nactiAdminLogyZBackendu() {
  try {
      const response = await fetch('/api/admin/logy?t=' + Date.now());
      adminLogy = await response.json();
      vykresliTabulkuAdminLogu();
  } catch (e) { console.error("Nelze načíst admin logy", e); }
}


// =====================================================================
// SPRÁVA ZAMĚSTNANCŮ — Formulář, uložení, mazání
// =====================================================================

/**
 * Odešle data formuláře na server — uloží nového zaměstnance nebo aktualizuje existujícího.
 * 
 * Logika ochrany před přepsáním nezměněných hodnot:
 *   - Tečky (••••) v polích čipu/PINu znamenají, že uživatel hodnotu neměnil
 *     → pole se odešle jako prázdné, server stávající hash zachová
 *   - Pro nového zaměstnance jsou čip i PIN povinné
 * 
 * PIN se validuje regulárním výrazem — pouze číslice, max 4 znaky.
 */
async function ulozitUzivatele() {
  const editId = document.getElementById('edit-id').value;
  const jmeno = document.getElementById('novy-jmeno').value.trim();
  let cip = document.getElementById('novy-cip').value.trim();
  let pin = document.getElementById('novy-pin').value.trim();
  const role = document.getElementById('novy-role').value;
  const hlaska_prichod = document.getElementById('novy-hlaska-prichod').value.trim();
  const hlaska_odchod = document.getElementById('novy-hlaska-odchod').value.trim();

  if(!jmeno) { 
    ukazToast('Chyba', '', 'Zadejte jméno!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
    return; 
  }

  // Ochrana při úpravě: Pokud jsou v polích tečky, znamená to, že uživatel kód neměnil
  if (editId) {
    if (cip === '••••••••') cip = '';
    if (pin === '••••') pin = '';
  } else {
    if (!cip || !pin) {
      ukazToast('Chyba', '', 'Zadejte čip a PIN!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
      return;
    }
  }

  // Kontrola PINu (pokud ho uživatel zadal/změnil)
  if (pin) {
      // Regulární výraz zkontroluje, že jde pouze o čísla a délka je 1 až 4
      if (!/^\d{1,4}$/.test(pin)) {
          ukazToast('Chyba', '', 'PIN smí obsahovat pouze čísla (max 4)!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
          return;
      }
  }

  const data = { id: editId ? parseInt(editId) : null, jmeno, cip, pin, role, hlaska_prichod, hlaska_odchod };

  try {
      const response = await fetch('/api/uzivatele/ulozit', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(data) 
      });
      
      const vysledek = await response.json();
      
      if(response.ok && vysledek.uspech) {
          // --- Úspěšné uložení ---
          vyfiltrovaniUzivatele = null; 
          const hledatInput = document.getElementById('hledat-zamestnance');
          if (hledatInput) hledatInput.value = '';
          
          await nactiUzivateleZBackendu();
          zrusitUpravu();
          ukazToast('Uloženo', jmeno, 'Data byla aktualizována.', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
      } else {
          // Server uložení zamítnul (např. duplicitní PIN)
          ukazToast('Akce zamítnuta', '', vysledek.chyba || 'Nešlo uložit data.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
      }
  } catch(e) { 
      console.error(e); 
      ukazToast('Chyba spojení', '', 'Nelze se spojit se serverem.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
  }
}

/**
 * Naplní formulář daty existujícího zaměstnance pro editaci.
 * 
 * Čip a PIN se zobrazí jako tečky — server je neposílá v čitelné podobě,
 * pracujeme pouze s hashi. Tečky signalizují "nezměněno".
 * 
 * @param {number} idUpravit - ID zaměstnance k úpravě
 */
function nacistDoUpravy(idUpravit) {
  const u = uzivatele.find(u => u.id === idUpravit);
  if(u) {
    document.getElementById('edit-id').value = u.id;
    document.getElementById('novy-jmeno').value = u.jmeno;
    document.getElementById('novy-cip').value = '••••••••'; // Skutečný čip neznáme — zobrazíme zástupný symbol
    document.getElementById('novy-pin').value = '••••';     // Skutečný PIN neznáme — zobrazíme zástupný symbol
    document.getElementById('novy-role').value = u.role;
    document.getElementById('novy-hlaska-prichod').value = u.hlaska_prichod || '';
    document.getElementById('novy-hlaska-odchod').value = u.hlaska_odchod || '';
    document.getElementById('formular-titulek').innerText = "Úprava zaměstnance";
    const btn = document.getElementById('btn-ulozit-uzivatele');
    btn.innerText = "Uložit změny"; btn.style.background = "rgba(16,185,129,0.1)"; btn.style.color = "var(--accent-green)";
    document.getElementById('btn-zrusit-upravu').style.display = "block";
    window.scrollTo(0, 0);
  }
}

/**
 * Vyresetuje formulář zaměstnance do výchozího stavu (přidání nového).
 * Skryje tlačítko "Zrušit úpravu" a vrátí titulku a stylu tlačítka původní podobu.
 */
function zrusitUpravu() {
  document.getElementById('edit-id').value = '';
  document.getElementById('novy-jmeno').value = ''; document.getElementById('novy-cip').value = '';
  document.getElementById('novy-pin').value = ''; document.getElementById('novy-role').value = 'Ucitel';
  document.getElementById('novy-hlaska-prichod').value = ''; document.getElementById('novy-hlaska-odchod').value = '';
  document.getElementById('formular-titulek').innerText = "Přidat nového zaměstnance";
  const btn = document.getElementById('btn-ulozit-uzivatele');
  btn.innerText = "+ Přidat"; btn.style.background = ""; btn.style.color = "";
  document.getElementById('btn-zrusit-upravu').style.display = "none";
}

/**
 * Trvale smaže zaměstnance z databáze po potvrzení uživatelem.
 * Server navíc brání smazání posledního správce systému.
 * 
 * @param {number} idSmazat - ID zaměstnance ke smazání
 */
async function smazatUzivatele(idSmazat) {
  if(confirm('Opravdu chcete tohoto zaměstnance trvale smazat z databáze?')) {
    try {
        const response = await fetch(`/api/uzivatele/smazat/${idSmazat}`, { method: 'DELETE' });
        const vysledek = await response.json(); 
        if (response.ok && vysledek.uspech) {
            await nactiUzivateleZBackendu();
            ukazToast('Smazáno', '', 'Zaměstnanec byl odstraněn.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        } else {
            ukazToast('Akce zamítnuta', '', vysledek.chyba || 'Došlo k neznámé chybě.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        }
    } catch(e) { console.error("Chyba při mazání:", e); }
  }
}


// =====================================================================
// STRÁNKOVÁNÍ A FILTRACE ZAMĚSTNANCŮ
// =====================================================================

let aktualniStranaUzivatele = 1;
const UZIVATELU_NA_STRANU = 10;
let vyfiltrovaniUzivatele = null; // null = filtr není aktivní, zobrazují se všichni

/**
 * Filtruje seznam zaměstnanců podle textu v poli hledat-zamestnance.
 * Vyhledávání ignoruje diakritiku na obou stranách (hledaný výraz i jméno).
 */
function filtrujZamestnance() {
  const text = document.getElementById('hledat-zamestnance').value.toLowerCase().trim();
  
  // Odstranění diakritiky z hledaného výrazu (např. "klementova" najde "Klementová")
  const textBezDiakritiky = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "");

  vyfiltrovaniUzivatele = uzivatele.filter(u => {
    // Odstranění diakritiky z uloženého jména pro srovnání
    const jmenoBezDiakritiky = u.jmeno.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    
    return jmenoBezDiakritiky.includes(textBezDiakritiky); 
  });
  
  aktualniStranaUzivatele = 1; // Po filtraci vždy začneme od první strany
  vykresliTabulkuUzivatelu();
}

/**
 * Přepne stránku v tabulce zaměstnanců.
 * @param {number} smer - +1 = další strana, -1 = předchozí strana
 */
function prepniStranuUzivatelu(smer) {
  aktualniStranaUzivatele += smer;
  vykresliTabulkuUzivatelu();
}

/**
 * Vykreslí tabulku zaměstnanců pro aktuální stranu.
 * 
 * Pracuje buď s vyfiltrovaným polem (vyfiltrovaniUzivatele) nebo se všemi (uzivatele).
 * Administrátoři (web_pass=true) jsou vizuálně odlišeni modrým tučným textem role.
 * Čip a PIN nikdy nezobrazujeme — server je ani neposílá, vždy jen tečky.
 */
function vykresliTabulkuUzivatelu() {
  const tbody = document.getElementById('tabulka-uzivatelu'); 
  if(!tbody) return;
  tbody.innerHTML = '';

  // Pracujeme buď s vyfiltrovanými, nebo se všemi uživateli
  const dataKzobrazeni = vyfiltrovaniUzivatele || uzivatele;

  // Výpočet stran
  const celkemStran = Math.ceil(dataKzobrazeni.length / UZIVATELU_NA_STRANU) || 1;
  if (aktualniStranaUzivatele > celkemStran) aktualniStranaUzivatele = celkemStran;
  if (aktualniStranaUzivatele < 1) aktualniStranaUzivatele = 1;

  // Oříznutí dat na aktuální 10člennou stranu
  const start = (aktualniStranaUzivatele - 1) * UZIVATELU_NA_STRANU;
  const dataStrana = dataKzobrazeni.slice(start, start + UZIVATELU_NA_STRANU);

  // Prázdný stav — žádný výsledek hledání
  if (dataStrana.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 20px;">Nenalezen žádný zaměstnanec.</td></tr>';
    const paginace = document.getElementById('strankovani-uzivatelu');
    if (paginace) paginace.innerHTML = '';
    return;
  }

  // Vykreslení řádků tabulky
  dataStrana.forEach(u => {
    let barvaRole = (u.web_pass || u.role === 'Administrator') ? 'color: var(--accent-blue); font-weight: bold;' : '';
    const hlaskyText = (u.hlaska_prichod || u.hlaska_odchod) ? `P: ${u.hlaska_prichod || '-'}<br>O: ${u.hlaska_odchod || '-'}` : '-';
    
    tbody.innerHTML += `<tr>
      <td><strong>${u.jmeno}</strong></td>
      <td style="color:var(--text-muted2); letter-spacing: 2px;">••••••••</td>
      <td style="color:var(--text-muted2); letter-spacing: 2px;">••••</td>
      <td style="${barvaRole}">${ziskejNazevRole(u.role)}</td>
      <td style="font-style: italic; font-size: 0.95rem;">${hlaskyText}</td>
      <td style="display: flex; gap: 8px;">
         <button onclick="nacistDoUpravy(${u.id})" class="btn-tabulka btn-upravit">Upravit</button>
         <button onclick="smazatUzivatele(${u.id})" class="btn-tabulka btn-smazat">Smazat</button>
      </td>
    </tr>`;
  });

  // Vykreslení ovládání stránek naspodu
  const paginace = document.getElementById('strankovani-uzivatelu');
  if (paginace) {
      paginace.innerHTML = `
        <button class="strankovani-btn" onclick="prepniStranuUzivatelu(-1)" ${aktualniStranaUzivatele === 1 ? 'disabled' : ''}>← Předchozí</button>
        <span>Strana ${aktualniStranaUzivatele} z ${celkemStran}</span>
        <button class="strankovani-btn" onclick="prepniStranuUzivatelu(1)" ${aktualniStranaUzivatele === celkemStran ? 'disabled' : ''}>Další →</button>
      `;
  }
}

/**
 * Naplní datalist pro autocomplete ve filtru docházky jmény všech zaměstnanců.
 */
function aktualizujSelectZamestnancu() {
  const datalist = document.getElementById('user-datalist'); datalist.innerHTML = '';
  uzivatele.forEach(u => { datalist.innerHTML += `<option value="${u.jmeno}">`; });
}


// =====================================================================
// HISTORIE DOCHÁZKY — Filtrování, stránkování, vykreslení
// =====================================================================

/**
 * Stáhne ze serveru záznamy docházky filtrované podle zadaných parametrů.
 * Filtrování provádí Python backend — posíláme mu jen parametry URL.
 * Po stažení resetuje stránkování a překreslí tabulku.
 */
async function aplikujFiltry() {
    const filtrJmeno = document.getElementById('filter-user').value.trim();
    const filtrOd = document.getElementById('filter-od').value;
    const filtrDo = document.getElementById('filter-do').value;
    const parametry = new URLSearchParams({ jmeno: filtrJmeno, od: filtrOd, do: filtrDo });
    try {
        const response = await fetch('/api/logy?' + parametry.toString());
        aktualniVyfiltrovanaData = await response.json();
        aktualniStrana = 1; vykresliTabulkuLogu();
    } catch (e) { console.error("Chyba při filtrování:", e); }
}

/**
 * Přepne stránku v tabulce logů docházky.
 * @param {number} smer - +1 = další strana, -1 = předchozí strana
 */
function prepniStranu(smer) { aktualniStrana += smer; vykresliTabulkuLogu(); }

/**
 * Vykreslí tabulku logů docházky pro aktuální stranu.
 * 
 * Datum se převádí z ISO formátu (RRRR-MM-DD) na česky čitelný (DD. MM. RRRR).
 * Poznámka k záznamu se zobrazí červeně a tučně za metodou záznamu.
 * Role zaměstnance se dohledává z globálního pole uzivatele podle jména.
 */
function vykresliTabulkuLogu() {
  const dataKzobrazeni = [...aktualniVyfiltrovanaData]; 
  const celkemStran = Math.ceil(dataKzobrazeni.length / ZAZNAMU_NA_STRANU) || 1;
  if (aktualniStrana > celkemStran) aktualniStrana = celkemStran;
  const dataStrana = dataKzobrazeni.slice((aktualniStrana - 1) * ZAZNAMU_NA_STRANU, (aktualniStrana - 1) * ZAZNAMU_NA_STRANU + ZAZNAMU_NA_STRANU);

  const tbody = document.getElementById('tabulka-logu'); tbody.innerHTML = '';
  if (dataStrana.length === 0) { tbody.innerHTML = '<tr><td colspan="3" style="text-align:center;">Nenalezeny žádné záznamy.</td></tr>'; document.getElementById('strankovani').innerHTML = ''; return; }

  dataStrana.forEach(log => {
    let uzivatelData = uzivatele.find(u => u.jmeno === log.jmeno);
    let roleText = uzivatelData ? ziskejNazevRole(uzivatelData.role) : '';

    let dParts = log.datumKratke.split('-');
    let hezkeDatum = `${dParts[2]}. ${dParts[1]}. ${dParts[0]}`;
    let poznamkaText = log.poznamka 
    ? ` - <span style="color: var(--accent-red); font-weight: bold;">${esc(log.poznamka)}</span>`
    : '';

    tbody.innerHTML += `<tr>
        <td style="color:var(--text-muted)">${hezkeDatum}<br><span style="color: var(--text-main); font-weight: bold;">${log.cas}</span></td>
        <td><strong>${esc(log.jmeno)}</strong><br><span style="font-size:0.85rem;">${roleText}</span></td>
        <td>${esc(log.akce)} <span style="font-size:0.8rem; display:block;">(${esc(log.metoda || 'Neznámo')}${poznamkaText})</span></td>
    </tr>`;
  });

  document.getElementById('strankovani').innerHTML = `
    <button class="strankovani-btn" onclick="prepniStranu(-1)" ${aktualniStrana === 1 ? 'disabled' : ''}>← Předchozí</button>
    <span>Strana ${aktualniStrana} z ${celkemStran}</span>
    <button class="strankovani-btn" onclick="prepniStranu(1)" ${aktualniStrana === celkemStran ? 'disabled' : ''}>Další →</button>
  `;
}


// =====================================================================
// EXPORT DO XLSX — Docházka, zaměstnanci, admin přístupy
// =====================================================================

/**
 * Exportuje aktuálně vyfiltrovaná data docházky do Excel souboru (.xlsx).
 * 
 * Struktura souboru:
 *   - Řádky 1–3: Název, zaměstnanec, období (sloučené buňky přes celou tabulku)
 *   - Řádek 4: Prázdný (odsazení od loga)
 *   - Řádek 5: Hlavička tabulky (modrý podklad, bílý text)
 *   - Řádky 6+: Data (zebra podbarvení, barevné odlišení Příchodu/Odchodu)
 * 
 * Logo se načte ze serveru a vloží do pravého horního rohu (sloupec F).
 * Soubor se pojmenuje podle jména zaměstnance a aktuálního data.
 */
async function stahnoutXLSX() {
    const dataKExportu = [...aktualniVyfiltrovanaData]; 
    
    if (dataKExportu.length === 0) { 
        alert('Nejsou žádná data ke stažení.'); 
        return; 
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Docházka');

    // Nastavení pro tisk na A4
    worksheet.pageSetup = {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        printTitlesRow: '1:5',
        margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
    };

    // Definice sloupců — včetně Role jako samostatného sloupce
    worksheet.columns = [
        { header: '', key: 'datum', width: 15 },
        { header: '', key: 'cas', width: 10 },
        { header: '', key: 'jmeno', width: 25 },
        { header: '', key: 'role', width: 25 }, // NOVÝ SLOUPEC
        { header: '', key: 'akce', width: 15 },
        { header: '', key: 'metoda', width: 18 }
    ];

    const filtrJmeno = document.getElementById('filter-user').value.trim() || 'Všichni zaměstnanci';
    const filtrOd = document.getElementById('filter-od').value;
    const filtrDo = document.getElementById('filter-do').value;
    
    // Sestavení textového popisu období z aktivních filtrů
    let obdobi = "Celá historie";
    if (filtrOd && filtrDo) obdobi = `${moment(filtrOd).format('D. M. YYYY')} – ${moment(filtrDo).format('D. M. YYYY')}`;
    else if (filtrOd) obdobi = `Od ${moment(filtrOd).format('D. M. YYYY')}`;
    else if (filtrDo) obdobi = `Do ${moment(filtrDo).format('D. M. YYYY')}`;

    // Sloučení buněk pro texty přes celou tabulku (A až F)
    worksheet.mergeCells('A1:F1');
    worksheet.mergeCells('A2:F2');
    worksheet.mergeCells('A3:F3');      

    worksheet.getCell('A1').value = 'VÝPIS DOCHÁZKY';
    worksheet.getCell('A1').font = { name: 'Calibri', size: 22, bold: true, color: { argb: 'FF1F2937' } };
    
    worksheet.getCell('A2').value = `Zaměstnanec: ${filtrJmeno}`;
    worksheet.getCell('A2').font = { name: 'Calibri', size: 12, bold: true };
    
    worksheet.getCell('A3').value = `Období: ${obdobi}`;
    worksheet.getCell('A3').font = { name: 'Calibri', size: 12, italic: true, color: { argb: 'FF4B5563' } };

    worksheet.getRow(1).height = 35;
    worksheet.getRow(2).height = 25;
    worksheet.getRow(3).height = 20;

    // Vložení loga (posunuto na sloupec F - index 5.1)
    try {
        const response = await fetch('/static/obrazky/loga/' + aktivniLogoExportu);
        if (response.ok) {
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const logoId = workbook.addImage({ buffer: buffer, extension: 'png' });
            worksheet.addImage(logoId, {
                // UKOTVENÍ: col: 5 znamená přesný začátek sloupce F (poslední sloupec)
                tl: { col: 5.0, row: 0.1 }, 
                // ROZMĚR: 130px je bezpečná šířka, která se vejde do sloupce F 
                // a nezasáhne do neviditelného sloupce G
                ext: { width: 130, height: 130 }
            });
        }
    } catch (e) { console.warn("Logo nelze načíst."); }

    // Hlavička tabulky — zarovnání doleva
    const headerRow = worksheet.getRow(5);
    headerRow.values = ['Datum', 'Čas', 'Jméno', 'Role', 'Akce', 'Způsob'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
    
    ['A', 'B', 'C', 'D', 'E', 'F'].forEach(col => {
        const cell = worksheet.getCell(`${col}5`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
        // Zarovnání hlavičky doleva
        cell.alignment = { horizontal: 'left', vertical: 'middle', indent: 1 };
    });

    // Zápis dat
    // Zápis dat
    dataKExportu.forEach((log, index) => {
        let dParts = log.datumKratke.split('-');
        let hezkeDatum = `${dParts[2]}. ${dParts[1]}. ${dParts[0]}`;
        
        let uzivatelData = uzivatele.find(u => u.jmeno === log.jmeno);
        let roleText = uzivatelData ? ziskejNazevRole(uzivatelData.role) : 'Neznámo';
        
        const row = worksheet.addRow({
            datum: hezkeDatum,
            cas: log.cas,
            jmeno: log.jmeno,
            role: roleText,
            akce: log.akce,
            metoda: log.metoda || ''
        });

        // Kompletní zarovnání doleva s malým vnitřním okrajem
        row.eachCell({ includeEmpty: true }, cell => {
            cell.alignment = { 
                horizontal: 'left', 
                vertical: 'middle', 
                wrapText: true,
                indent: 1 // Malý vnitřní okraj, aby text nebyl nalepený úplně na čáře
            };
        });

        // Zebra podbarvení sudých řádků
        if (index % 2 === 0) {
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            });
        }

        // Barevné odlišení textu akce (Příchod = zelená, Odchod = červená)
        const akceCell = row.getCell('akce');
        if (log.akce === 'Příchod') akceCell.font = { color: { argb: 'FF10B981' }, bold: true };
        else if (log.akce === 'Odchod') akceCell.font = { color: { argb: 'FFEF4444' }, bold: true };
    });

    worksheet.autoFilter = `A5:F${5 + dataKExportu.length}`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const nazevSouboru = `Dochazka_${filtrJmeno.replace(/\s+/g, '_')}_${moment().format('YYYY-MM-DD')}.xlsx`;
    saveAs(blob, nazevSouboru);
}

/**
 * Exportuje seznam všech zaměstnanců do Excel souboru (.xlsx).
 * 
 * Data jsou seřazena primárně podle role, sekundárně podle jména (česky).
 * Administrátoři jsou zvýrazněni tučně a modrým textem v sloupci přístupu.
 * Sloupec přístupu rozlišuje "Správce administrace" vs "Běžný uživatel".
 */
async function stahnoutZamestnanceXLSX() {
    if (!uzivatele || uzivatele.length === 0) { 
        alert('Nejsou žádná data ke stažení.'); 
        return; 
    }

    // Klonování a řazení: primárně podle role, sekundárně podle jména
    const dataKExportu = [...uzivatele].sort((a, b) => {
        if (a.role < b.role) return -1;
        if (a.role > b.role) return 1;
        return a.jmeno.localeCompare(b.jmeno, 'cs');
    });

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Zaměstnanci');

    // Nastavení pro tisk na A4
    worksheet.pageSetup = {
        paperSize: 9,
        orientation: 'portrait',
        fitToPage: true,
        fitToWidth: 1,
        fitToHeight: 0,
        horizontalCentered: true,
        printTitlesRow: '1:5',
        margins: { left: 0.5, right: 0.5, top: 0.75, bottom: 0.75, header: 0.3, footer: 0.3 }
    };

    // Šířka sloupců (upraveno na míru zaměstnancům)
    worksheet.columns = [
        { header: '', key: 'jmeno', width: 35 },
        { header: '', key: 'role', width: 25 },
        { header: '', key: 'pristup', width: 20 },
        { header: '', key: 'hlaska_p', width: 25 },
        { header: '', key: 'hlaska_o', width: 25 }
    ];

    // Sloučení buněk pro texty hlavičky
    worksheet.mergeCells('A1:D1');
    worksheet.mergeCells('A2:D2');
    worksheet.mergeCells('A3:D3');

    worksheet.getCell('A1').value = 'SEZNAM ZAMĚSTNANCŮ';
    worksheet.getCell('A1').font = { name: 'Calibri', size: 22, bold: true, color: { argb: 'FF1F2937' } };
    worksheet.getCell('A1').alignment = { horizontal: 'left', vertical: 'middle' };
    
    worksheet.getCell('A2').value = `Aktuální stav ke dni: ${moment().format('D. M. YYYY')}`;
    worksheet.getCell('A2').font = { name: 'Calibri', size: 12, bold: true };
    
    worksheet.getCell('A3').value = `Celkový počet registrovaných osob: ${dataKExportu.length}`;
    worksheet.getCell('A3').font = { name: 'Calibri', size: 12, italic: true, color: { argb: 'FF4B5563' } };

    // Výška řádků kvůli logu
    worksheet.getRow(1).height = 35;
    worksheet.getRow(2).height = 25;
    worksheet.getRow(3).height = 20;

    // Vložení čtvercového loga (stejně jako u docházky)
    try {
        const response = await fetch('/static/obrazky/loga/' + (typeof aktivniLogoExportu !== 'undefined' ? aktivniLogoExportu : 'dochazkac_logo.png'));
        if (response.ok) {
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const logoId = workbook.addImage({
                buffer: buffer,
                extension: 'png',
            });
            worksheet.addImage(logoId, {
                tl: { col: 4.6, row: 0.1 }, 
                ext: { width: 145, height: 145 }
            });
        }
    } catch (e) {
        console.warn("Logo se nepodařilo načíst.");
    }

    // Hlavička tabulky
    const headerRow = worksheet.getRow(5);
    headerRow.values = ['Jméno a příjmení', 'Kategorie (Role)', 'Systémový přístup', 'Vlastní hláška (Příchod)', 'Vlastní hláška (Odchod)'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    
    ['A', 'B', 'C', 'D', 'E'].forEach(col => {
        const cell = worksheet.getCell(`${col}5`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
        cell.border = {
            top: { style: 'thin', color: { argb: 'FF9CA3AF' } },
            bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } }
        };
    });

    // Zápis dat zaměstnanců
    dataKExportu.forEach((u, index) => {
        const row = worksheet.addRow({
            jmeno: u.jmeno,
            role: ziskejNazevRole(u.role),
            pristup: u.web_pass ? 'Správce administrace' : 'Běžný uživatel',
            hlaska_p: u.hlaska_prichod || '-',
            hlaska_o: u.hlaska_odchod || '-'
        });

        row.alignment = { vertical: 'middle' };
        row.getCell('role').alignment = { horizontal: 'center' };
        row.getCell('pristup').alignment = { horizontal: 'center' };
        row.getCell('hlaska_p').alignment = { horizontal: 'center', wrapText: true };
        row.getCell('hlaska_o').alignment = { horizontal: 'center', wrapText: true };

        // Zebrování řádků
        if (index % 2 === 0) {
            row.eachCell({ includeEmpty: true }, cell => {
                cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } };
            });
        }

        row.eachCell({ includeEmpty: true }, cell => {
            cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } };
        });

        // Barevné odlišení administrátorů — tučné jméno, modrý text přístupu
        if (u.web_pass || u.role === 'Administrator') {
            row.getCell('jmeno').font = { bold: true };
            row.getCell('pristup').font = { color: { argb: 'FF3B82F6' }, bold: true };
        }
    });

    worksheet.autoFilter = `A5:E${5 + dataKExportu.length}`;

    // Vygenerování souboru a spuštění stažení
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const nazevSouboru = `Zamestnanci_${moment().format('YYYY-MM-DD')}.xlsx`;
    saveAs(blob, nazevSouboru);
}


// =====================================================================
// SPRÁVCI A PRÁVA — Tabulka adminů, přidání, odebrání
// =====================================================================

// Globální proměnné pro admin logy a aktivní logo exportu
let aktivniLogoExportu = 'dochazkac_logo.png';
let aktualniAdminStrana = 1;
const ADMIN_LOGY_NA_STRANU = 10;

/**
 * Přepne stránku v tabulce admin logů.
 * @param {number} smer - +1 = další strana, -1 = předchozí strana
 */
function prepniAdminStranu(smer) {
    aktualniAdminStrana += smer;
    vykresliTabulkuAdminLogu();
}

/**
 * Vykreslí tabulku přístupů správců do administrace.
 * 
 * Aplikuje volitelný filtr datumového rozsahu (admin-filter-od / admin-filter-do).
 * Neúspěšné pokusy jsou vizuálně odlišeny červenou barvou a textem "(NEAUTORIZOVANÝ POKUS)".
 */
function vykresliTabulkuAdminLogu() {
  const tbody = document.getElementById('tabulka-admin-logu');
  if(!tbody) return; 
  tbody.innerHTML = '';

  const filtrOd = document.getElementById('admin-filter-od')?.value;
  const filtrDo = document.getElementById('admin-filter-do')?.value;

  // Aplikace datumového filtru na admin logy
  let vyfiltrovaneLogy = adminLogy.filter(log => {
      if (filtrOd && log.datumKratke < filtrOd) return false;
      if (filtrDo && log.datumKratke > filtrDo) return false;
      return true;
  });
  
  // Výpočet stran
  const celkemStran = Math.ceil(vyfiltrovaneLogy.length / ADMIN_LOGY_NA_STRANU) || 1;
  if (aktualniAdminStrana > celkemStran) aktualniAdminStrana = celkemStran;
  if (aktualniAdminStrana < 1) aktualniAdminStrana = 1;

  // Výběr dat pro aktuální stranu
  const start = (aktualniAdminStrana - 1) * ADMIN_LOGY_NA_STRANU;
  const dataKzobrazeni = vyfiltrovaneLogy.slice(start, start + ADMIN_LOGY_NA_STRANU);
  
  if (dataKzobrazeni.length === 0) { 
      tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding: 20px;">Žádné záznamy pro zvolené období.</td></tr>'; 
      const paginace = document.getElementById('strankovani-admin');
      if (paginace) paginace.innerHTML = '';
      return; 
  }

  dataKzobrazeni.forEach(log => {
    let dParts = log.datumKratke.split('-');
    let hezkeDatum = `${dParts[2]}. ${dParts[1]}. ${dParts[0]}`;
    // Neúspěšné pokusy zvýrazníme červeně s průhledným pozadím
    const radekStyl = log.uspesne ? "" : "color: var(--accent-red); font-weight: bold; background: rgba(239, 68, 68, 0.05);";
    const statusText = log.uspesne ? "" : " (NEAUTORIZOVANÝ POKUS)";
    
    tbody.innerHTML += `<tr style="${radekStyl}">
      <td style="color:inherit">${hezkeDatum}<br><span style="font-weight: bold;">${log.cas}</span></td>
      <td><strong>${log.jmeno}</strong></td>
      <td><span style="font-size:0.85rem;">${log.metoda}</span><div style="font-size:0.75rem;">${statusText}</div></td>
    </tr>`;
  });

  // Vykreslení ovládání stránek
  const paginace = document.getElementById('strankovani-admin');
  if (paginace) {
      paginace.innerHTML = `
        <button class="strankovani-btn" onclick="prepniAdminStranu(-1)" ${aktualniAdminStrana === 1 ? 'disabled' : ''}>← Předchozí</button>
        <span>Strana ${aktualniAdminStrana} z ${celkemStran}</span>
        <button class="strankovani-btn" onclick="prepniAdminStranu(1)" ${aktualniAdminStrana === celkemStran ? 'disabled' : ''}>Další →</button>
      `;
  }
}

/**
 * Vykreslí tabulku stávajících správců a select pro přidání nového.
 * 
 * Do tabulky jdou pouze zaměstnanci s web_pass=true (mají webové heslo).
 * Do selectu pro přidání jdou všichni ostatní (bez web_pass).
 */
function vykresliTabulkuAdminu() {
  const tbody = document.getElementById('tabulka-adminu');
  if(!tbody) return;
  tbody.innerHTML = '';
  
  const select = document.getElementById('admin-vyber-uzivatele');
  if(select) select.innerHTML = '<option value="">-- Vyberte zaměstnance --</option>';

  uzivatele.forEach(u => {
    // Do tabulky správců zobrazíme pouze ty s webovým přístupem
    if (u.web_pass) {
      tbody.innerHTML += `<tr>
        <td><strong>${u.jmeno}</strong></td>
        <td>Login: ${u.username || '-'}<br><span style="font-size:0.8rem">${u.email || '-'}</span></td>
        <td><button class="btn-tabulka btn-smazat" onclick="odebratAdmina(${u.id})">Odebrat práva</button></td>
      </tr>`;
    }
  });

  // Zbytek zaměstnanců (bez webového přístupu) nabídneme v selectu pro povýšení
  uzivatele.filter(u => !u.web_pass).forEach(u => {
    if(select) select.innerHTML += `<option value="${u.id}">${u.jmeno}</option>`;
  });
}

/**
 * Přidá vybranému zaměstnanci přihlašovací údaje pro webovou administraci.
 * Zaměstnanec i heslo jsou povinné. Po úspěchu vyčistí formulář.
 */
async function pridatAdmina() {
  const idUzivatele = document.getElementById('admin-vyber-uzivatele').value;
  const username = document.getElementById('admin-username').value.trim();
  const email = document.getElementById('admin-email').value.trim();
  const heslo = document.getElementById('admin-heslo').value.trim();

  if (!idUzivatele || !heslo) { 
      ukazToast('Chyba', '', 'Vyberte zaměstnance a zadejte heslo!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
      return; 
  }
  
  try {
    const response = await fetch('/api/admin/ulozit', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify({ id: idUzivatele, username: username, email: email, heslo: heslo }) 
    });
    
    const vysledek = await response.json();
    
    if (response.ok && vysledek.uspech) {
      await nactiUzivateleZBackendu(); 
      document.getElementById('admin-username').value = ''; document.getElementById('admin-email').value = ''; document.getElementById('admin-heslo').value = '';
      ukazToast('Práva udělena', '', 'Správce byl úspěšně uložen do databáze.', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
    } else {
      ukazToast('Akce zamítnuta', '', vysledek.chyba || 'Nelze udělit práva.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
    }
  } catch (e) { 
      // Vizuální ošetření výpadku připojení
      console.error("Chyba komunikace se serverem:", e); 
      ukazToast('Chyba spojení', '', 'Nelze se spojit se serverem. Zkontrolujte připojení.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
  }
}

/**
 * Odebere zaměstnanci přístup do webové administrace po potvrzení.
 * Zaměstnanec zůstane v systému jako běžný uživatel.
 * Server brání odebrání práv poslednímu správci.
 * 
 * @param {number} idAdmina - ID zaměstnance, kterému odebíráme práva
 */
async function odebratAdmina(idAdmina) {
  if (confirm('Opravdu chcete tomuto uživateli odebrat přístup do administrace?')) {
    try {
      const response = await fetch(`/api/admin/odebrat/${idAdmina}`, { method: 'DELETE' });
      const vysledek = await response.json(); 
      if (response.ok && vysledek.uspech) {
        await nactiUzivateleZBackendu();
        ukazToast('Odebráno', '', 'Správcovská práva byla smazána z DB.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
      } else {
        ukazToast('Akce zamítnuta', '', vysledek.chyba || 'Nelze odebrat práva.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
      }
    } catch (e) { console.error("Chyba:", e); }
  }
}


// =====================================================================
// NASTAVENÍ — Tapeta, ukládání sekcí, tovární reset, systémové akce
// =====================================================================

/**
 * Nastaví tapetu terminálu jako CSS background-image na body.
 * Krátká jména ('skola', 'dochazkac') převede na plné názvy souborů.
 * 
 * @param {string} hodnota     - Název souboru tapety nebo zkratkový alias
 * @param {boolean} zapsat_do_db - true = zároveň uloží nastavení do databáze
 */
function zmenitTapetu(hodnota, zapsat_do_db = true) {
    if (hodnota === 'skola') hodnota = 'skola.webp';
    if (hodnota === 'dochazkac') hodnota = 'dochazkac.webp';
    
    let obrazek = `/static/obrazky/tapety/${hodnota}`;
    // Tmavý přechod přes tapetu zajišťuje čitelnost bílého textu
    document.body.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.3), rgba(0, 0, 0, 0.4)), url('${obrazek}')`;
    
    if (zapsat_do_db) { 
        ulozitNastaveni('terminal'); 
    }
}

/**
 * Uloží vybranou sekci nastavení na server.
 * 
 * Každá sekce má svá specifická pole — funkce sestaví objekt dataKodeslani
 * podle toho, která sekce se ukládá. Navíc vždy přidá společná pole
 * (logo, spořič, reset, tapeta, auto-odchod), která se odesílají vždy.
 * 
 * @param {string} sekce - 'obecne' | 'zalohy' | 'gdpr' | 'rozvrh' | 'terminal' | 'export'
 */
async function ulozitNastaveni(sekce) {
  let dataKodeslani = {}; let zprava = '';

  if (sekce === 'obecne') {
    // Základní údaje organizace — název, IČO, telefon, adresa, e-mail
    dataKodeslani = { 
      'obecne_nazev': document.getElementById('set-nazev').value, 
      'obecne_ico': document.getElementById('set-ico').value, 
      'obecne_tel': document.getElementById('set-tel').value, 
      'obecne_adresa': document.getElementById('set-adresa').value,
      'obecne_email': document.getElementById('set-kontakt-email').value 
    };
    kontaktniEmailAdmin = document.getElementById('set-kontakt-email').value;
    zprava = 'Údaje organizace uloženy.';
    
  } else if (sekce === 'zalohy') { 
    // Automatické zálohování databáze — zapnuto/vypnuto a frekvence
    dataKodeslani = {
      'zaloha_db_zapnuto': document.getElementById('set-zaloha-db').checked ? 'true' : 'false',
      'zaloha_frekvence': document.getElementById('set-zaloha-frekvence').value
    };
    zprava = 'Pravidla pro zálohování databáze byla uložena.';
    
  } else if (sekce === 'gdpr') {
    // Retenční lhůta GDPR — po jaké době se mažou záznamy
    dataKodeslani = { 'gdpr_retence': document.getElementById('set-retence').value }; 
    zprava = 'Pravidla pro uchovávání dat (GDPR) uložena.';
    
  } else if (sekce === 'rozvrh') {
    // Rozvrh vyučovacích hodin — načteme z DOM tabulky a převedeme na minuty
    aktivniRozvrh = [];
    document.querySelectorAll('#rozvrh-body tr').forEach(radek => {
        const nazev = radek.querySelector('td:nth-child(1) input').value; 
        const odCas = radek.querySelector('td:nth-child(2) input').value; 
        const doCas = radek.querySelector('td:nth-child(3) input').value;
        if (odCas && doCas) { 
            const [hOd, mOd] = odCas.split(':').map(Number); 
            const [hDo, mDo] = doCas.split(':').map(Number); 
            aktivniRozvrh.push({ nazev: nazev, odMin: hOd * 60 + mOd, doMin: hDo * 60 + mDo, text: nazev }); 
        }
    });
    dataKodeslani = { 'rozvrh_data': JSON.stringify(aktivniRozvrh) };
    // Pracovní dny — ze zaškrtnutých checkboxů sestavíme pole čísel dnů
    pracovniDny = Array.from(document.querySelectorAll('.pracovni-dny-grid input:checked')).map(cb => parseInt(cb.value));
    dataKodeslani['rozvrh_dny'] = JSON.stringify(pracovniDny);
    aktualizujVyucovaciHodinu(); 
    zprava = 'Harmonogram trvale uložen.';
    
  } else if (sekce === 'terminal') {
    // Chování terminálu — okamžitě promítneme nové časy do živého systému
    DOBA_NECINNOSTI_PRO_SPORIC = parseInt(document.getElementById('set-sporic').value) * 1000;
    DOBA_RESETU_AKCE = parseInt(document.getElementById('set-reset').value) * 1000;
    if (typeof resetSporic === 'function') resetSporic();
    
    zprava = 'Nastavení chování terminálu uloženo.';
    
  } else if (sekce === 'export') {
    // Vzhled exportů — aktivní logo pro XLSX výstupy
    aktivniLogoExportu = document.getElementById('set-logo').value;
    zprava = 'Vzhled exportů a výpisů byl úspěšně uložen.';
  }

  // Tato pole se odesílají vždy, bez ohledu na sekci — zajišťují konzistenci nastavení
  dataKodeslani['export_logo'] = document.getElementById('set-logo')?.value || aktivniLogoExportu;
  dataKodeslani['term_sporic'] = document.getElementById('set-sporic').value;
  dataKodeslani['term_reset'] = document.getElementById('set-reset').value;
  dataKodeslani['term_tapeta'] = document.getElementById('set-tapeta').value;
  dataKodeslani['term_auto_odchod'] = document.getElementById('set-auto-odchod').checked ? 'true' : 'false';

  try {
      const response = await fetch('/api/nastaveni', { 
          method: 'POST', 
          headers: { 'Content-Type': 'application/json' }, 
          body: JSON.stringify(dataKodeslani) 
      });
      
      if (response.ok) {
          ukazToast('Uloženo', 'Nastavení systému', zprava, 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
      } else {
          // Server akci zamítl (nejspíše vypršela session)
          const vysledek = await response.json();
          ukazToast('Chyba uložení', '', vysledek.chyba || 'Zkontrolujte připojení nebo se znovu přihlaste.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
      }
  } catch(e) { 
      console.error('Chyba:', e);
      ukazToast('Kritická chyba', '', 'Nelze se spojit se serverem.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
  }
}

/**
 * Provede tovární reset — smaže veškerá data ze všech tabulek.
 * 
 * Vyžaduje trojitou ochranu:
 *   1. Ověřovací slovo "RESTARTOVAT" napsané přesně
 *   2. Přihlašovací jméno správce
 *   3. Heslo správce
 *   4. Potvrzení v confirm dialogu
 * 
 * Po úspěšném resetu zobrazí černou obrazovku a po 3 sekundách přesměruje na /setup.
 */
async function provedTovarniReset() {
    const potvrzeni = document.getElementById('reset-potvrzeni').value;
    const login = document.getElementById('reset-login').value;
    const heslo = document.getElementById('reset-heslo').value;

    if (potvrzeni !== "RESTARTOVAT" || !login || !heslo) { ukazToast('Chyba', '', 'Špatně vyplněná ochrana před smazáním!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); return; }
    
    if (confirm("Tímto smažete celou databázi! NEVRATNÁ AKCE!")) {
        try {
            const response = await fetch('/api/tovarni_reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ potvrzeni: potvrzeni, login: login, heslo: heslo }) });
            const vysledek = await response.json();
            if (response.ok) {
                // Překreslíme celou stránku — není kam se vrátit
                document.body.innerHTML = '<div style="background: #000; width: 100vw; height: 100vh; display: flex; flex-direction:column; justify-content: center; align-items: center; color: #fff;"><h2>VYMAZÁNO</h2></div>';
                setTimeout(() => window.location.href = "/setup", 3000);
            } else { ukazToast('Chyba', '', vysledek.chyba, 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); }
        } catch (e) { console.error('Chyba:', e); }
    }
}

/**
 * Provede systémovou akci (restart nebo vypnutí serveru).
 * 
 * restart: Odhlásí správce, zobrazí loader a za 3s reload stránky
 *          (server se mezitím restartuje a bude znovu ready)
 * 
 * problem: Zobrazí kontaktní e-mail pro nahlášení problému
 * 
 * vypnout: Pošle příkaz k vypnutí, zobrazí loader a za 2.5s překreslí
 *          stránku na statickou "TERMINÁL JE VYPNUTÝ" obrazovku
 * 
 * @param {string} akce - 'restart' | 'problem' | 'vypnout'
 */
async function akceSystemu(akce) {
  // Zjištění jména aktuálně přihlášeného správce pro log
  let jmenoAdmina = "Neznámý";
  const ulozenaSess = localStorage.getItem('adminSess');
  if (ulozenaSess) {
      jmenoAdmina = JSON.parse(ulozenaSess).jmeno;
  }

  if (akce === 'restart') { 
    if (confirm('Opravdu chcete restartovat aplikaci docházky? (Dojde k restartu serveru)')) { 
      try {
        // Posíláme jméno na server pro zápis do logu
        await fetch('/api/system/restart', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jmeno: jmenoAdmina })
        });
        
        // Okamžité odhlášení správce před restartem
        localStorage.removeItem('adminSess');
        
        // Ukážeme loader s textem restartu
        const loader = document.getElementById('admin-loader');
        if (loader) {
            loader.classList.remove('fade-out');
            loader.style.display = 'flex';
            const textEl = loader.querySelector('.admin-loader-text');
            if (textEl) textEl.innerText = 'Restartuji systém...';
        }
        
        // Za 3 vteřiny reload — prohlížeč načte stránku znovu a vyžádá si nové přihlášení
        setTimeout(() => window.location.reload(), 3000);
      } catch(e) { console.error('Chyba restartu:', e); }
    } 
  } 
  else if (akce === 'problem') { 
    // Zobrazíme kontaktní e-mail ze settings nebo obecný text
    const email = (typeof kontaktniEmailAdmin !== 'undefined' && kontaktniEmailAdmin.trim() !== '') ? kontaktniEmailAdmin : 'vedení školy';
    ukazToast('Nahlásit problém', '', `V případě potíží s terminálem prosím kontaktujte: ${email}`, 'var(--accent-yellow)', 'rgba(245, 158, 11, 0.6)', null);
  } 
  else if (akce === 'vypnout') { 
    if (confirm('VAROVÁNÍ: Opravdu chcete natvrdo vypnout server terminálu? Zařízení se poté možná bude muset nahodit manuálně.')) { 
      try {
        // Přednačteme logo, aby bylo dostupné i po vypnutí serveru (z cache prohlížeče)
        const logoCesta = '/static/obrazky/loga/dochazkac_logo.png';
        const preloadImg = new Image();
        preloadImg.src = logoCesta;

        // Posíláme příkaz k vypnutí na server
        await fetch('/api/system/vypnout', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jmeno: jmenoAdmina })
        });
        
        // Zobrazíme loader s textem vypínání
        const loader = document.getElementById('admin-loader');
        if (loader) {
            loader.classList.remove('fade-out');
            loader.style.display = 'flex';
            const textEl = loader.querySelector('.admin-loader-text');
            if (textEl) textEl.innerText = 'Vypínám terminál...';
        }

        // Po 2.5 vteřinách překreslíme obrazovku na statickou "vypnuto" stránku
        setTimeout(() => {
            document.body.innerHTML = `
              <div style="background-color: #000; width: 100vw; height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; cursor: none;">
                <img src="${logoCesta}" alt="Logo" style="width: 250px; height: 250px; margin-bottom: 50px; opacity: 0.8;">
                <span style="color: var(--accent-red); font-size: 3.5rem; font-weight: 900; letter-spacing: 3px; text-align: center;">TERMINÁL JE VYPNUTÝ</span>
                <span style="color: #64748b; font-size: 1.8rem; margin-top: 25px; text-transform: uppercase; font-weight: 700; text-align: center;">kontaktujte správce IT</span>
              </div>`;
        }, 2500);
        
      } catch(e) { console.error('Chyba vypnutí:', e); }
    } 
  }
}

/**
 * Přidá nový prázdný řádek do tabulky rozvrhu vyučovacích hodin.
 * Výchozí časy jsou 08:55–09:40 (typická školní hodina).
 */
function pridatRadekRozvrhu() {
  const tbody = document.getElementById('rozvrh-body'); const tr = document.createElement('tr');
  tr.innerHTML = `<td><input type="text" placeholder="Např. 2. vyučovací hodina"></td><td><input type="time" value="08:55"></td><td><input type="time" value="09:40"></td><td style="text-align: center;"><select style="padding: 6px; width: 100%;"><option value="hodina">Hodina</option><option value="pauza">Přestávka</option></select></td><td style="text-align: center;"><button class="btn-tabulka btn-smazat" onclick="this.closest('tr').remove()" style="padding: 6px 12px;">✕</button></td>`;
  tbody.appendChild(tr);
}


// =====================================================================
// DRAG & DROP — Přetahování karet nastavení
// =====================================================================

let dndInicializovano = false; // Ochrana před dvojitou inicializací

/**
 * Inicializuje drag & drop pro karty na záložce Nastavení.
 * Spouští se pouze jednou — při opakovaném volání funkce se nic nestane.
 * Pořadí karet se ukládá do localStorage a obnovuje při každém načtení.
 */
function inicializujDragAndDrop() {
  if (dndInicializovano) return;
  const kontejner = document.querySelector('#tab-admini .settings-grid'); if (!kontejner) return;
  const karty = kontejner.querySelectorAll('.admin-card');
  
  karty.forEach((karta, index) => {
    karta.setAttribute('draggable', 'true'); karta.classList.add('draggable-card');
    if (!karta.id) karta.id = 'nastaveni-karta-' + index; // Přiřadíme ID pro uložení pořadí
    karta.addEventListener('dragstart', () => { karta.classList.add('dragging'); });
    karta.addEventListener('dragend', () => { karta.classList.remove('dragging'); ulozitPoradiKaret(); });
  });

  kontejner.addEventListener('dragover', e => {
    e.preventDefault(); 
    const tahanaKarta = document.querySelector('.dragging'); if (!tahanaKarta) return;
    const dalsiKarta = ziskejElementPodKurzorem(kontejner, e.clientY);
    if (dalsiKarta == null) { kontejner.appendChild(tahanaKarta); } else { kontejner.insertBefore(tahanaKarta, dalsiKarta); }
  });
  obnovitPoradiKaret(kontejner); dndInicializovano = true;
}

/**
 * Najde element, nad kterým se právě táhne karta (pro vložení před něj).
 * Používá geometrii elementů — hledá nejbližší element pod kurzorem.
 * 
 * @param {HTMLElement} kontejner - Rodičovský kontejner s kartami
 * @param {number} y - Aktuální Y pozice kurzoru
 * @returns {HTMLElement|undefined} Element, před který vložíme táhnutou kartu
 */
function ziskejElementPodKurzorem(kontejner, y) {
  const ostatniKarty = [...kontejner.querySelectorAll('.admin-card:not(.dragging)')];
  return ostatniKarty.reduce((nejblizsi, element) => {
    const box = element.getBoundingClientRect(); const offset = y - box.top - box.height / 2;
    if (offset < 0 && offset > nejblizsi.offset) { return { offset: offset, element: element }; } else { return nejblizsi; }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

/** Uloží aktuální pořadí karet (podle jejich ID) do localStorage. */
function ulozitPoradiKaret() {
  const kontejner = document.querySelector('#tab-admini .settings-grid');
  const poradi = [...kontejner.querySelectorAll('.admin-card')].map(k => k.id);
  localStorage.setItem('poradiKaretNastaveni', JSON.stringify(poradi));
}

/**
 * Obnoví pořadí karet podle uloženého pořadí v localStorage.
 * Pokud localStorage neobsahuje žádné pořadí, karty zůstanou v původním HTML pořadí.
 * 
 * @param {HTMLElement} kontejner - Rodičovský kontejner s kartami
 */
function obnovitPoradiKaret(kontejner) {
  const ulozenePoradi = JSON.parse(localStorage.getItem('poradiKaretNastaveni')); if (!ulozenePoradi) return;
  ulozenePoradi.forEach(id => { const karta = document.getElementById(id); if (karta) kontejner.appendChild(karta); });
}


// =====================================================================
// WIZARD — Průvodce prvním spuštěním
// =====================================================================

let aktualniKrokWiz = 1; const celkemKrokuWiz = 3;

/**
 * Zkontroluje URL a pokud jde o /setup, zobrazí průvodce prvním nastavením.
 * Skryje terminál i administraci, zobrazí wizard-view a nastaví tapetu.
 * Také zastaví spořič — není potřeba na setup stránce.
 */
function zkontrolujPrvniSpusteni() {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('setup') === 'true' || window.location.pathname === '/setup') {
    // Nastavení tmavší tapety pro větší čitelnost bílého textu wizardu
    document.body.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.65), rgba(0, 0, 0, 0.75)), url('/static/obrazky/tapety/dochazkac.webp')`;
    
    document.getElementById('terminal-view').style.display = 'none'; 
    document.getElementById('admin-view').style.display = 'none'; 
    document.getElementById('wizard-view').style.display = 'flex';
    // ... zbytek funkce zůstává stejný ...
    
    aktualniKrokWiz = 1;
    document.querySelectorAll('.wizard-step').forEach(step => step.classList.remove('active'));
    document.getElementById('wiz-step-1').classList.add('active');
    
    clearTimeout(sporicTimer); document.removeEventListener('mousemove', resetSporic, true);
  }
}

/**
 * Zpracuje navigaci v průvodci (Další / Zpět).
 * 
 * Na posledním kroku (krok 3, směr vpřed) nejdříve validuje vstupní data:
 *   - Všechna povinná pole musí být vyplněna
 *   - PIN musí mít přesně 4 číslice
 * 
 * Po validaci zavolá dokoncitWizard() místo přechodu na další krok.
 * 
 * @param {number} smer - +1 = vpřed, -1 = zpět
 */
function krokWizardu(smer) {
  if (smer === 1 && aktualniKrokWiz === 3) {
      const jmeno = document.getElementById('wiz-admin-jmeno').value.trim(); 
      const pin = document.getElementById('wiz-admin-pin').value.trim();
      const heslo = document.getElementById('wiz-admin-heslo').value.trim(); 
      const username = document.getElementById('wiz-admin-username').value.trim(); 
      
      // 1. Kontrola, zda je vše vyplněno
      if (!jmeno || !pin || !heslo || !username) { 
          ukazToast('Chyba', '', 'Vyplňte Jméno, PIN, Login a Heslo správce!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
          return; 
      }
      
      // 2. Přesná kontrola formátu PINu (musí být přesně 4 čísla)
      if (pin.length !== 4 || !/^\d{4}$/.test(pin)) {
          ukazToast('Chyba', '', 'PIN musí obsahovat přesně 4 číslice!', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); 
          return;
      }
      
      dokoncitWizard(); 
      return;
  }
  
  // Standardní přechod mezi kroky — skryjeme aktuální, zobrazíme nový
  document.getElementById(`wiz-step-${aktualniKrokWiz}`).classList.remove('active');
  aktualniKrokWiz += smer;
  document.getElementById(`wiz-step-${aktualniKrokWiz}`).classList.add('active');
  document.getElementById('wiz-progress-bar').style.width = `${(aktualniKrokWiz / celkemKrokuWiz) * 100}%`;
  document.getElementById('btn-wiz-prev').style.display = aktualniKrokWiz === 1 ? 'none' : 'block';
  document.getElementById('btn-wiz-next').innerText = aktualniKrokWiz === celkemKrokuWiz ? 'Dokončit a spustit' : 'Pokračovat';
}

/**
 * Dokončí průvodce — uloží prvního správce a výchozí nastavení do databáze.
 * 
 * Postup:
 *   1. Skryje wizard, zobrazí loader s textem "Nastavuji systém..."
 *   2. Vytvoří zaměstnance (API uzivatele/ulozit)
 *   3. Přiřadí mu admin práva (API admin/ulozit)
 *   4. Uloží výchozí nastavení terminálu (tapeta, spořič, auto-odchod)
 *   5. Po 5 sekundách schová loader, zobrazí terminál a přesměruje URL na /
 */
/**
 * Dokončí průvodce — uloží prvního správce a výchozí nastavení do databáze.
 */
async function dokoncitWizard() {
  // 1. Skryjeme celý instalační průvodce a zapneme náš černý loader
  document.getElementById('wizard-view').style.display = 'none';
  
  const loader = document.getElementById('admin-loader');
  if (loader) {
      loader.classList.remove('fade-out');
      loader.style.display = 'flex';
      
      const textEl = loader.querySelector('.admin-loader-text');
      if (textEl) textEl.innerText = 'Nastavuji a připravuji systém...';
  }

  // 2. Pošleme všechna data jedním požadavkem na nechráněný instalační endpoint
  try {
    const instalacniData = {
        jmeno: document.getElementById('wiz-admin-jmeno').value.trim(),
        pin: document.getElementById('wiz-admin-pin').value.trim(),
        username: document.getElementById('wiz-admin-username').value.trim(),
        email: document.getElementById('wiz-admin-email').value.trim(),
        heslo: document.getElementById('wiz-admin-heslo').value.trim()
    };

    const response = await fetch('/api/setup/dokoncit', { 
        method: 'POST', 
        headers: { 'Content-Type': 'application/json' }, 
        body: JSON.stringify(instalacniData) 
    });

    const vysledek = await response.json();

    if (!response.ok || !vysledek.uspech) {
        ukazToast('Chyba', '', vysledek.chyba || 'Chyba instalace', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        if (loader) loader.classList.add('fade-out');
        document.getElementById('wizard-view').style.display = 'flex'; // Zobrazíme průvodce znovu
        return;
    }

    // Instalace proběhla v pořádku, stáhneme do klienta nová data
    await nactiUzivateleZBackendu();
    if (typeof nactiNastaveniZBackendu === 'function') await nactiNastaveniZBackendu();
  } catch (e) { 
      console.error("Chyba při Průvodci:", e); 
      ukazToast('Kritická chyba', '', 'Spojení selhalo.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
      return;
  }

  localStorage.setItem('dochazkac_nastaveno', 'true');
  
  // 3. Po 5 sekundách ukážeme hotový terminál a přesměrujeme URL
  setTimeout(() => {
    if (loader) loader.classList.add('fade-out');
    
    document.body.style.backgroundImage = `linear-gradient(rgba(0, 0, 0, 0.45), rgba(0, 0, 0, 0.55)), url('/static/obrazky/tapety/dochazkac.webp')`;
    
    document.getElementById('terminal-view').style.display = 'flex';
    document.addEventListener('mousemove', resetSporic, true); 
    resetSporic();
    
    // Změníme URL z /setup na / bez reloadu stránky
    window.history.replaceState({}, document.title, '/');
    ukazToast('Připraveno', 'Docházkáč', 'Váš systém byl úspěšně spuštěn!', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
    
    // Po zmizení loaderu vrátíme text zpět pro příští přihlašování do Administrace
    setTimeout(() => {
        const textEl = loader.querySelector('.admin-loader-text');
        if (textEl) textEl.innerText = 'Načítání...';
    }, 500);
    
  }, 5000);
}

// Spuštění kontroly prvního spuštění po načtení DOM
window.addEventListener('DOMContentLoaded', zkontrolujPrvniSpusteni);


// =====================================================================
// SPRÁVA TAPET — Načtení, nahrání, smazání
// =====================================================================

/**
 * Načte seznam dostupných tapet ze serveru a naplní select v nastavení.
 * Továrním tapetám přiřadí čitelné názvy. Po naplnění obnoví dříve vybranou hodnotu.
 */
async function nactiSeznamTapet() {
    try {
        const response = await fetch('/api/admin/tapety');
        const tapety = await response.json();
        const select = document.getElementById('set-tapeta');
        const aktualniHodnota = select.value; // Zapamatujeme si aktuální výběr před překreslením
        
        select.innerHTML = '';
        tapety.forEach(t => {
            let nazev = t;
            if (t === 'dochazkac.webp') nazev = 'Výchozí (Docházkáč)';
            if (t === 'skola.webp') nazev = 'Fotografie (Budova školy)';
            select.innerHTML += `<option value="${t}">${nazev}</option>`;
        });
        
        // Obnovení dříve vybrané hodnoty (normalizujeme zkratkové aliasy na plné názvy)
        let v = aktualniHodnota;
        if (v === 'skola') v = 'skola.webp'; if (v === 'dochazkac') v = 'dochazkac.webp';
        if ([...select.options].some(o => o.value === v)) select.value = v;
        
    } catch(e) { console.error("Nelze načíst tapety:", e); }
}

/**
 * Nahraje vybraný soubor tapety na server.
 * Před nahráním ověří velikost (max 2 MB) a rozlišení (max 1920x1080px).
 * Po úspěšném nahrání automaticky nastaví novou tapetu jako aktivní.
 */
async function nahratTapetu() {
    const input = document.getElementById('upload-tapeta-input');
    if (!input.files || input.files.length === 0) { ukazToast('Chyba', '', 'Vyberte soubor na disku.', 'var(--accent-red)', 'rgba(239,68,68,0.6)'); return; }
    const file = input.files[0];
    
    // JS Kontrola velikosti (2 MB) — rychlá kontrola před nahráním
    if (file.size > 2 * 1024 * 1024) { ukazToast('Zamítnuto', '', 'Soubor je větší než 2 MB!', 'var(--accent-red)', 'rgba(239,68,68,0.6)'); return; }

    // JS Kontrola rozlišení — načteme obraz do paměti a zkontrolujeme rozměry
    const img = new Image();
    img.onload = async function() {
        if (this.width > 1920 || this.height > 1080) {
            ukazToast('Zamítnuto', '', 'Obrázek překračuje maximální rozlišení 1920x1080px.', 'var(--accent-red)', 'rgba(239,68,68,0.6)');
            return;
        }
        
        const formData = new FormData(); formData.append('file', file);
        try {
            const response = await fetch('/api/admin/tapety/upload', { method: 'POST', body: formData });
            const vysledek = await response.json();
            if (vysledek.uspech) {
                ukazToast('Nahráno', '', 'Nová tapeta uložena na server.', 'var(--accent-green)', 'rgba(16,185,129,0.6)');
                input.value = ''; // Vyčištění pole pro případ dalšího nahrání
                await nactiSeznamTapet();
                // Automaticky novou tapetu hned nastavíme jako aktivní
                document.getElementById('set-tapeta').value = vysledek.soubor;
                zmenitTapetu(vysledek.soubor, true);
            } else { ukazToast('Chyba', '', vysledek.chyba, 'var(--accent-red)', 'rgba(239,68,68,0.6)'); }
        } catch (e) { console.error(e); }
    };
    img.src = URL.createObjectURL(file); // Spustí načtení obrázku pro kontrolu rozlišení
}

/**
 * Smaže vybranou tapetu ze serveru po potvrzení.
 * Tovární tapety (dochazkac, skola) nelze smazat — kontrola probíhá i na serveru.
 * Po smazání přepne na výchozí tapetu a obnoví seznam.
 */
async function smazatTapetu() {
    const select = document.getElementById('set-tapeta');
    const filename = select.value;
    
    // Ochrana před smazáním továrních tapet
    if (filename.includes('dochazkac') || filename.includes('skola')) {
        ukazToast('Zamítnuto', '', 'Tovární tapety nelze smazat.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        return;
    }

    if (confirm(`Opravdu smazat tapetu s názvem ${filename} z disku serveru?`)) {
        try {
            const response = await fetch(`/api/admin/tapety/${filename}`, { method: 'DELETE' });
            const vysledek = await response.json();
            if (vysledek.uspech) {
                ukazToast('Smazáno', '', 'Soubor byl trvale smazán.', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
                document.getElementById('set-tapeta').value = 'dochazkac.webp'; // Přepnutí na zálohu
                zmenitTapetu('dochazkac.webp', true);
                nactiSeznamTapet();
            } else { ukazToast('Chyba', '', vysledek.chyba, 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); }
        } catch (e) { console.error(e); }
    }
}


// =====================================================================
// SPRÁVA LOG — Načtení, nahrání, smazání, výběr aktivního loga
// =====================================================================

/**
 * Načte seznam dostupných log ze serveru a naplní select v nastavení.
 * Výchozímu logu přiřadí čitelný název. Obnoví dříve aktivní logo.
 */
async function nactiSeznamLog() {
    try {
        const response = await fetch('/api/admin/loga');
        const loga = await response.json();
        const select = document.getElementById('set-logo');
        
        select.innerHTML = '';
        loga.forEach(l => {
            let nazev = l;
            if (l === 'dochazkac_logo.png') nazev = 'Výchozí (Docházkáč)';
            select.innerHTML += `<option value="${l}">${nazev}</option>`;
        });
        
        // Obnovení dříve aktivního loga v selectu
        if ([...select.options].some(o => o.value === aktivniLogoExportu)) {
            select.value = aktivniLogoExportu;
        }
    } catch(e) { console.error("Nelze načíst loga:", e); }
}

/**
 * Nastaví logo vybrané v selectu jako aktivní a uloží volbu do databáze.
 */
function zmenitLogo() {
    aktivniLogoExportu = document.getElementById('set-logo').value;
    ulozitNastaveni('export'); 
}

/**
 * Nahraje vybraný soubor loga na server.
 * Kontroluje velikost (max 2 MB). Po nahrání automaticky aktivuje nové logo.
 */
async function nahratLogo() {
    const input = document.getElementById('upload-logo-input');
    if (!input.files || input.files.length === 0) { ukazToast('Chyba', '', 'Vyberte soubor.', 'var(--accent-red)', 'rgba(239,68,68,0.6)'); return; }
    const file = input.files[0];
    
    // Kontrola velikosti souboru (max 2 MB)
    if (file.size > 2 * 1024 * 1024) { ukazToast('Zamítnuto', '', 'Soubor je větší než 2 MB!', 'var(--accent-red)', 'rgba(239,68,68,0.6)'); return; }

    const formData = new FormData(); formData.append('file', file);
    try {
        const response = await fetch('/api/admin/loga/upload', { method: 'POST', body: formData });
        const vysledek = await response.json();
        if (vysledek.uspech) {
            ukazToast('Nahráno', '', 'Nové logo uloženo.', 'var(--accent-green)', 'rgba(16,185,129,0.6)');
            input.value = '';
            await nactiSeznamLog();
            document.getElementById('set-logo').value = vysledek.soubor;
            zmenitLogo(); // Rovnou ho aktivuje a uloží do DB
        } else { ukazToast('Chyba', '', vysledek.chyba, 'var(--accent-red)', 'rgba(239,68,68,0.6)'); }
    } catch (e) { console.error(e); }
}

/**
 * Smaže vybrané logo ze serveru po potvrzení.
 * Výchozí tovární logo (dochazkac_logo.png) nelze smazat.
 * Po smazání přepne na výchozí logo a obnoví seznam.
 */
async function smazatLogo() {
    const select = document.getElementById('set-logo');
    const filename = select.value;
    
    // Ochrana před smazáním továrního loga
    if (filename === 'dochazkac_logo.png') {
        ukazToast('Zamítnuto', '', 'Výchozí tovární logo nelze smazat.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        return;
    }

    if (confirm(`Opravdu trvale smazat logo ${filename}?`)) {
        try {
            const response = await fetch(`/api/admin/loga/${filename}`, { method: 'DELETE' });
            const vysledek = await response.json();
            if (vysledek.uspech) {
                ukazToast('Smazáno', '', 'Logo bylo odstraněno.', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
                document.getElementById('set-logo').value = 'dochazkac_logo.png';
                zmenitLogo(); // Přepne aktivní logo zpět na výchozí
                nactiSeznamLog();
            } else { ukazToast('Chyba', '', vysledek.chyba, 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)'); }
        } catch (e) { console.error(e); }
    }
}


// =====================================================================
// EXPORT ADMIN LOGŮ DO XLSX
// =====================================================================

/**
 * Exportuje historii přístupů správců do Excel souboru (.xlsx).
 * 
 * Respektuje aktivní datumový filtr (admin-filter-od / admin-filter-do).
 * Neúspěšné pokusy jsou v sloupci Výsledek zvýrazněny červeně textem "Odepřeno".
 * Struktura souboru je shodná s ostatními exporty (hlavička, logo, zebra).
 */
async function stahnoutAdminXLSX() {
    const filtrOd = document.getElementById('admin-filter-od')?.value;
    const filtrDo = document.getElementById('admin-filter-do')?.value;
    
    // Filtrování admin logů podle datumového rozsahu (probíhá v JS, ne na serveru)
    let dataKExportu = adminLogy.filter(log => {
        if (filtrOd && log.datumKratke < filtrOd) return false;
        if (filtrDo && log.datumKratke > filtrDo) return false;
        return true;
    });

    if (dataKExportu.length === 0) { 
        alert('Nejsou žádná data ke stažení.'); 
        return; 
    }

    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Přístupy');

    // Nastavení tisku na A4 na výšku
    worksheet.pageSetup = {
        paperSize: 9, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        horizontalCentered: true, printTitlesRow: '1:5'
    };

    worksheet.columns = [
        { header: '', key: 'datum', width: 16 },
        { header: '', key: 'cas', width: 12 },
        { header: '', key: 'jmeno', width: 30 },
        { header: '', key: 'metoda', width: 25 },
        { header: '', key: 'status', width: 20 }
    ];

    // Sestavení textového popisu zvoleného období
    let obdobi = "Celá historie";
    if (filtrOd && filtrDo) obdobi = `${moment(filtrOd).format('D. M. YYYY')} – ${moment(filtrDo).format('D. M. YYYY')}`;
    else if (filtrOd) obdobi = `Od ${moment(filtrOd).format('D. M. YYYY')}`;
    else if (filtrDo) obdobi = `Do ${moment(filtrDo).format('D. M. YYYY')}`;

    // Sloučení buněk pro texty hlavičky (A–D)
    worksheet.mergeCells('A1:D1'); worksheet.mergeCells('A2:D2'); worksheet.mergeCells('A3:D3');
    worksheet.getCell('A1').value = 'HISTORIE PŘÍSTUPŮ SPRÁVCŮ';
    worksheet.getCell('A1').font = { name: 'Calibri', size: 22, bold: true, color: { argb: 'FF1F2937' } };
    worksheet.getCell('A2').value = `Období: ${obdobi}`;
    worksheet.getCell('A2').font = { name: 'Calibri', size: 12, bold: true };
    worksheet.getCell('A3').value = `Vytvořeno: ${moment().format('D. M. YYYY HH:mm')}`;
    worksheet.getCell('A3').font = { name: 'Calibri', size: 12, italic: true, color: { argb: 'FF4B5563' } };

    worksheet.getRow(1).height = 35; worksheet.getRow(2).height = 25; worksheet.getRow(3).height = 20;

    // Vložení loga do pravého horního rohu
    try {
        const response = await fetch('/static/obrazky/loga/' + (typeof aktivniLogoExportu !== 'undefined' ? aktivniLogoExportu : 'dochazkac_logo.png'));
        if (response.ok) {
            const blob = await response.blob();
            const buffer = await blob.arrayBuffer();
            const logoId = workbook.addImage({ buffer: buffer, extension: 'png' });
            worksheet.addImage(logoId, { tl: { col: 4.1, row: 0.1 }, ext: { width: 145, height: 145 } });
        }
    } catch (e) { console.warn("Logo nelze načíst."); }

    // Hlavička tabulky — modrý podklad, bílý text
    const headerRow = worksheet.getRow(5);
    headerRow.values = ['Datum', 'Čas', 'Správce', 'Způsob ověření', 'Výsledek'];
    headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' }, size: 12 };
    headerRow.alignment = { vertical: 'middle', horizontal: 'center' };
    
    ['A', 'B', 'C', 'D', 'E'].forEach(col => {
        const cell = worksheet.getCell(`${col}5`);
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF3B82F6' } };
        cell.border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } }, bottom: { style: 'medium', color: { argb: 'FF1D4ED8' } } };
    });

    dataKExportu.forEach((log, index) => {
        let dParts = log.datumKratke.split('-');
        let hezkeDatum = `${dParts[2]}. ${dParts[1]}. ${dParts[0]}`;
        
        const row = worksheet.addRow({
            datum: hezkeDatum, cas: log.cas, jmeno: log.jmeno, metoda: log.metoda, status: log.uspesne ? 'Úspěšně' : 'Odepřeno'
        });

        row.alignment = { vertical: 'middle' };
        row.getCell('cas').alignment = { horizontal: 'center' };
        row.getCell('datum').alignment = { horizontal: 'center' };
        row.getCell('status').alignment = { horizontal: 'center' };

        // Zebra podbarvení sudých řádků
        if (index % 2 === 0) {
            row.eachCell({ includeEmpty: true }, cell => { cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF9FAFB' } }; });
        }
        row.eachCell({ includeEmpty: true }, cell => { cell.border = { bottom: { style: 'thin', color: { argb: 'FFE5E7EB' } } }; });

        // Barevné odlišení výsledku — červená = odepřeno, zelená = úspěch
        if (!log.uspesne) { row.getCell('status').font = { color: { argb: 'FFEF4444' }, bold: true }; } 
        else { row.getCell('status').font = { color: { argb: 'FF10B981' }, bold: true }; }
    });

    worksheet.autoFilter = `A5:E${5 + dataKExportu.length}`;

    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `AdminPristupy_${moment().format('YYYY-MM-DD')}.xlsx`);
}


// =====================================================================
// INICIALIZACE PO NAČTENÍ STRÁNKY
// =====================================================================

/**
 * Po načtení DOM nastaví klávesové zkratky pro přihlašovací formulář
 * a zpracuje URL pro rozhodnutí, co zobrazit (administrace / terminál / setup).
 * 
 * Logika větvení:
 *   isAdmin  → pure-admin-mode, loader, kontrola platné session
 *   !isSetup → klasický terminál, loader 1.5s pro načtení tapety a rozvrhu
 *   isSetup  → průvodce (obsluhuje zkontrolujPrvniSpusteni)
 */
window.addEventListener('DOMContentLoaded', () => {
  const adminPassInput = document.getElementById('admin-pass');
  const adminUserInput = document.getElementById('admin-user');

  // Enter v poli pro heslo → odeslání přihlášení; Enter v poli pro login → focus na heslo
  if(adminPassInput && adminUserInput) {
    adminPassInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') overitAdminLogin(); });
    adminUserInput.addEventListener('keypress', function (e) { if (e.key === 'Enter') adminPassInput.focus(); });
  }

  const urlParams = new URLSearchParams(window.location.search);
  
  // Zjistíme, kde přesně se uživatel nachází
  const isSetup = urlParams.get('setup') === 'true' || window.location.pathname === '/setup';
  const isAdmin = urlParams.get('admin') === 'true' || window.location.pathname === '/admin';
  const loader = document.getElementById('admin-loader');

  // --- 1. LOGIKA PRO PŘIHLÁŠENÍ DO ADMINISTRACE ---
  if (isAdmin) {
    document.body.classList.add('pure-admin-mode'); 
    
    // Zobrazíme loader s textem "Načítání..."
    if (loader) {
        loader.classList.remove('fade-out');
        loader.style.display = 'flex';
        const textEl = loader.querySelector('.admin-loader-text');
        if (textEl) textEl.innerText = 'Načítání...';
    }
    
    if (typeof sporicTimer !== 'undefined') clearTimeout(sporicTimer); 
    if (typeof skrytSporic === 'function') skrytSporic(); 

    // Při každém kliknutí prodloužíme platnost relace
    document.addEventListener('click', obnovAdminRelaci);
    
    // Krátká prodleva pro dokončení načítání dat z DOMContentLoaded v data.js
    setTimeout(() => {
        const ulozenaSess = localStorage.getItem('adminSess');
        if (ulozenaSess) {
            const dataSess = JSON.parse(ulozenaSess);
            if (Date.now() < dataSess.expires) {
                // Platná relace — prodloužíme ji a pustíme rovnou do administrace
                obnovAdminRelaci(); 
                if (typeof otevriAdmin === 'function') otevriAdmin();
                
                if (loader) loader.classList.add('fade-out');
                return; 
            } else {
                // Relace vypršela — smažeme ji a zobrazíme přihlašovací okno
                localStorage.removeItem('adminSess');
            }
        }

        // Žádná platná relace — zobrazíme přihlašovací formulář
        if (typeof otevriAdminLogin === 'function') otevriAdminLogin();
        if (loader) loader.classList.add('fade-out');
        
    }, 1200); 
  } 
  // --- 2. LOGIKA PRO KLASICKÝ TERMINÁL DOCHÁZKY ---
  else if (!isSetup) {
    
    // Zapneme loader s textem načítání
    if (loader) {
        loader.classList.remove('fade-out');
        loader.style.display = 'flex';
        const textEl = loader.querySelector('.admin-loader-text');
        if (textEl) textEl.innerText = 'Načítání...';
    }
    
    // Prodleva 1.5s — stihnou se načíst tapeta, rozvrh a hodiny
    setTimeout(() => {
        if (loader) loader.classList.add('fade-out');
        
        // Po zmizení loaderu vrátíme focus na RFID vstup — systém je ready
        const rfidInput = document.getElementById('rfid-input');
        if (rfidInput) rfidInput.focus();
        
    }, 1500);
  }
});


// =====================================================================
// ZÁLOHOVÁNÍ A VÝBĚR SLOŽKY
// =====================================================================

/**
 * Vyvolá systémový dialog pro výběr složky zálohy (přes Python backend).
 * Pokud uživatel složku vybere, zapíše cestu do pole set-backup-path.
 * Zobrazí modré upozornění, že výběr je třeba ještě uložit.
 */
async function vybratSlozku() {
    try {
        const response = await fetch('/api/system/vybrat_slozku');
        const vysledek = await response.json();
        
        if (response.ok && vysledek.uspech && vysledek.cesta) {
            document.getElementById('set-backup-path').value = vysledek.cesta;
            // Modré upozornění — cesta je zapsaná, ale ještě neuložená do DB
            ukazToast('Složka načtena', '', 'Cesta zapsána. Nezapomeňte zálohování dole ULOŽIT.', 'var(--accent-blue)', 'rgba(59, 130, 246, 0.6)');
        } else if (vysledek.chyba !== "Výběr zrušen") {
            ukazToast('Upozornění', '', vysledek.chyba, 'var(--accent-yellow)', 'rgba(245, 158, 11, 0.6)');
        }
    } catch(e) {
        console.error(e);
        ukazToast('Chyba', '', 'Nelze vyvolat systémový dialog.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
    }
}

/**
 * Spustí okamžitou manuální zálohu databáze.
 * Server zkopíruje databázový soubor do složky zalohy_databaze s časovým razítkem.
 */
async function zalohovatHned() {
    // 1. Zjistíme jméno aktuálně přihlášeného admina z localStorage
    let jmenoAdmina = "Neznámý správce";
    const ulozenaSess = localStorage.getItem('adminSess');
    if (ulozenaSess) {
        jmenoAdmina = JSON.parse(ulozenaSess).jmeno;
    }

    try {
        // 2. Přidáme hlavičky a pošleme jméno v těle požadavku (body)
        const response = await fetch('/api/zalohovat', { 
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ jmeno: jmenoAdmina })
        });
        const vysledek = await response.json();
        
        if (response.ok && vysledek.uspech) {
            ukazToast('Zálohováno', '', 'Databáze byla zkopírována do složky: zalohy_databaze', 'var(--accent-green)', 'rgba(16, 185, 129, 0.6)');
        } else {
            ukazToast('Chyba uložení', '', vysledek.chyba || 'Zálohování selhalo.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
        }
    } catch(e) {
        console.error(e);
        ukazToast('Chyba serveru', '', 'Spojení selhalo. Server neodpovídá.', 'var(--accent-red)', 'rgba(239, 68, 68, 0.6)');
    }
}