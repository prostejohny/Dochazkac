from typing import Protocol, List, Iterator, runtime_checkable
import unicodedata  

# =====================================================================
# PROTOKOLY (INTERFACE)
# =====================================================================

@runtime_checkable
class SpojovaStruktura(Protocol):
    """Protokol (interface) definující společné rozhraní pro spojové struktury.
    
    Díky @runtime_checkable lze ověřit splnění protokolu za běhu
    pomocí isinstance(). Každá třída, která implementuje tyto tři
    metody, automaticky protokol splňuje — bez nutnosti dědit.
    """
    def ziskej_vsechny_jako_seznam(self) -> List[dict]:
        ...
        
    def __iter__(self) -> Iterator:
        """Kolekce musí být iterovatelná (použitelná v cyklu for)."""
        ...
        
    def __len__(self) -> int:
        """Kolekce musí vracet svou délku (použitelná s len())."""
        ...


# =====================================================================
# JEDNOSMĚRNÝ SPOJOVÝ SEZNAM (ZÁSOBNÍK) PRO LOGY
# =====================================================================

class ZaznamNode:
    """Jeden uzel spojového seznamu — uchovává data jednoho záznamu docházky
    a odkaz na následující uzel v seznamu.
    """
    def __init__(self, id_zaznamu, datum, cas, jmeno, akce, metoda, poznamka=None):
        self.id = id_zaznamu
        self.datum = datum
        self.cas = cas
        self.jmeno = jmeno
        self.akce = akce
        self.metoda = metoda
        self.poznamka = poznamka
        self.dalsi = None  # Odkaz na následující uzel (None = konec seznamu)


class HistorieDochazky:
    """Jednosměrný spojový seznam uchovávající historii docházky.
    
    Nové záznamy se vkládají na začátek (hlavu) seznamu, takže
    iterací získáme záznamy od nejnovějšího po nejstarší.
    Implementuje protokol SpojovaStruktura.
    """
    def __init__(self):
        self.hlava = None  # Odkaz na první (nejnovější) uzel
        self.pocet = 0     # Průběžný počet uzlů pro O(1) přístup k délce

    def __iter__(self):
        """Generátor umožňující procházet seznam cyklem for.
        
        Každé volání si drží vlastní stav (aktualni), takže
        více vláken může seznam procházet současně bezpečně.
        """
        aktualni = self.hlava
        while aktualni is not None:
            yield aktualni
            aktualni = aktualni.dalsi

    def __len__(self):
        """Vrací počet záznamů v seznamu v O(1) — splnění protokolu."""
        return self.pocet

    # --- Základní operace nad seznamem ---

    def pridej_zaznam(self, id_zaznamu, datum, cas, jmeno, akce, metoda, poznamka=None):
        """Vloží nový záznam na začátek seznamu (O(1) složitost).
        
        Vkládání na hlavu zajišťuje, že nejnovější záznamy jsou vždy první.
        """
        # Guard clause — odmítneme neplatná data dříve, než cokoliv vytvoříme
        if not jmeno or not datum:
            raise ValueError("Jméno a datum nesmí být prázdné.")
            
        novy_uzel = ZaznamNode(id_zaznamu, datum, cas, jmeno, akce, metoda, poznamka)
        # Nový uzel ukáže na dosavadní hlavu a sám se stane novou hlavou
        novy_uzel.dalsi = self.hlava
        self.hlava = novy_uzel
        self.pocet += 1

    def smaz_zaznam(self, id_zaznamu):
        """Odstraní uzel se zadaným ID. Vrací True při úspěchu, False pokud nenalezen.
        
        Prochází seznam a udržuje odkaz na předchozí uzel,
        aby bylo možné přemostit mazaný uzel.
        """
        aktualni = self.hlava
        predchozi = None

        while aktualni is not None:
            if aktualni.id == id_zaznamu:
                if predchozi is None:
                    # Mažeme první uzel — novou hlavou se stane jeho následník
                    self.hlava = aktualni.dalsi
                else:
                    # Přemostíme mazaný uzel: předchozí ukáže na následující
                    predchozi.dalsi = aktualni.dalsi
                self.pocet -= 1
                return True
            predchozi = aktualni
            aktualni = aktualni.dalsi
        return False  # Uzel s daným ID nebyl nalezen

    def najdi_zaznamy_uzivatele(self, hledane_jmeno):
        """Vrátí seznam všech uzlů patřících danému zaměstnanci."""
        nalezene = []
        for zaznam in self:
            if zaznam.jmeno == hledane_jmeno:
                nalezene.append(zaznam)
        return nalezene

    def ziskej_vsechny_jako_seznam(self):
        """Převede celý spojový seznam na seznam slovníků (pro JSON odpovědi API)."""
        vysledek = []
        for zaznam in self:
            vysledek.append({
                "id": zaznam.id,
                "datumKratke": zaznam.datum,
                "cas": zaznam.cas,
                "jmeno": zaznam.jmeno,
                "akce": zaznam.akce,
                "metoda": zaznam.metoda,
                "poznamka": zaznam.poznamka  # Konzistentně vracíme i poznámku
            })
        return vysledek

    # ---------------------------------------------------------
    # ALGORITMY NAD SPOJOVOU STRUKTUROU 
    # ---------------------------------------------------------

    def najdi_chybejici_odchody(self, dnesni_datum_str):
        """Najde zaměstnance, kteří si zapomněli zapsat odchod.
        
        Prochází seznam od nejnovějšího záznamu. Pro každou kombinaci
        (jméno, datum) zkontroluje pouze první výskyt — ten je nejnovější.
        Pokud je nejnovější záznam daného dne 'Příchod' (a není to dnešek),
        znamená to, že odchod chybí.
        """
        chybejici_odchody = []
        zkontrolovane_dny = set()  # Ukládáme tuple (jméno, datum) již zkontrolovaných dnů

        for zaznam in self:
            # Unikátní klíč pro kombinaci zaměstnanec + konkrétní den
            klic = (zaznam.jmeno, zaznam.datum)
            
            if klic not in zkontrolovane_dny:
                zkontrolovane_dny.add(klic)
                
                # Poslední záznam dne je 'Příchod' a nejde o dnešek → chybí odchod
                if zaznam.akce == 'Příchod' and zaznam.datum < dnesni_datum_str:
                    chybejici_odchody.append({
                        'jmeno': zaznam.jmeno,
                        'datum': zaznam.datum 
                    })

        return chybejici_odchody

    def vyfiltruj_zaznamy(self, hledane_jmeno="", datum_od="", datum_do=""):
        """Vrátí záznamy splňující všechna zadaná kritéria filtru.
        
        Vyhledávání jména je odolné vůči diakritice na obou stranách
        (hledaný výraz i uložené jméno jsou před porovnáním normalizovány).
        Prázdný parametr znamená 'bez omezení' pro dané kritérium.
        """
        vysledek = []
        hledane_jmeno = hledane_jmeno.lower().strip()
        
        # Odstraníme diakritiku z hledaného výrazu (např. "klement" najde "Klementová")
        hledane_jmeno_bez = ''.join(
            c for c in unicodedata.normalize('NFD', hledane_jmeno) 
            if unicodedata.category(c) != 'Mn'
        )

        for zaznam in self:
            # Odstraníme diakritiku i ze jména uloženého v záznamu
            zaznam_jmeno_nizsi = zaznam.jmeno.lower()
            zaznam_jmeno_bez = ''.join(
                c for c in unicodedata.normalize('NFD', zaznam_jmeno_nizsi) 
                if unicodedata.category(c) != 'Mn'
            )

            # Všechna tři kritéria musí být splněna zároveň
            sedi_jmeno = (hledane_jmeno_bez == "") or (hledane_jmeno_bez in zaznam_jmeno_bez)
            sedi_od = (not datum_od) or (zaznam.datum >= datum_od)
            sedi_do = (not datum_do) or (zaznam.datum <= datum_do)
            
            if sedi_jmeno and sedi_od and sedi_do:
                vysledek.append({
                    "id": zaznam.id,
                    "datumKratke": zaznam.datum,
                    "cas": zaznam.cas,
                    "jmeno": zaznam.jmeno,
                    "akce": zaznam.akce,
                    "metoda": zaznam.metoda,
                    "poznamka": zaznam.poznamka 
                })
                
        return vysledek


# =====================================================================
# TŘÍDÍCÍ ALGORITMUS — INSERTION SORT
# =====================================================================

def serad_zaznamy_podle_casu(seznam_zaznamu):
    """Vlastní implementace algoritmu Insertion Sort.
    
    Řadí seznam slovníků (logů) sestupně podle data a času (od nejnovějšího).
    Třídí přímo předaný seznam (in-place) a zároveň ho vrací.
    Časová složitost: O(n²) — pro očekávaný počet záznamů dostačující.
    """
    for i in range(1, len(seznam_zaznamu)):
        klicovy_zaznam = seznam_zaznamu[i]
        j = i - 1
        
        klic_datum = klicovy_zaznam['datumKratke']
        # Čas doplníme nulou zleva na 8 znaků (9:15:00 → 09:15:00),
        # aby textové porovnání fungovalo správně i pro jednociferné hodiny
        klic_cas = klicovy_zaznam['cas'].zfill(8)
        
        # Posouváme prvky doprava, dokud nenajdeme správnou pozici
        # Řadíme SESTUPNĚ — podmínka je obrácená oproti vzestupnému řazení
        while j >= 0 and (seznam_zaznamu[j]['datumKratke'], seznam_zaznamu[j]['cas'].zfill(8)) < (klic_datum, klic_cas):
            seznam_zaznamu[j + 1] = seznam_zaznamu[j]
            j -= 1
            
        seznam_zaznamu[j + 1] = klicovy_zaznam
        
    return seznam_zaznamu


# =====================================================================
# BINÁRNÍ VYHLEDÁVACÍ STROM (BST) PRO ZAMĚSTNANCE 
# =====================================================================

class UzivatelNode:
    """Jeden uzel BST — uchovává objekt zaměstnance a odkazy na potomky."""
    def __init__(self, uzivatel):
        self.uzivatel = uzivatel
        self.levy = None   # Levý potomek (jméno abecedně menší)
        self.pravy = None  # Pravý potomek (jméno abecedně větší nebo stejné)


class BSTUzivatelu:
    """Binární vyhledávací strom pro rychlé vyhledávání zaměstnanců podle jména.
    
    Řazení uzlů je abecední podle atributu jmeno.
    
    POZNÁMKA: Při abecedním pořadí vstupních dat (např. načtení z DB ORDER BY jmeno)
    může strom degenerovat na lineární strukturu O(n). Pro školní projekt
    s malým počtem zaměstnanců je to akceptovatelné.
    """
    def __init__(self):
        self.koren = None

    # --- Vkládání ---

    def vloz(self, uzivatel):
        """Vloží zaměstnance do stromu na správnou pozici podle jména."""
        if self.koren is None:
            self.koren = UzivatelNode(uzivatel)
        else:
            self._vloz_rekurzivne(self.koren, uzivatel)

    def _vloz_rekurzivne(self, aktualni, uzivatel):
        """Rekurzivně najde správnou pozici a vloží nový uzel."""
        if uzivatel.jmeno < aktualni.uzivatel.jmeno:
            # Jméno je menší → patří do levého podstromu
            if aktualni.levy is None:
                aktualni.levy = UzivatelNode(uzivatel)
            else:
                self._vloz_rekurzivne(aktualni.levy, uzivatel)
        else:
            # Jméno je větší nebo stejné → patří do pravého podstromu
            if aktualni.pravy is None:
                aktualni.pravy = UzivatelNode(uzivatel)
            else:
                self._vloz_rekurzivne(aktualni.pravy, uzivatel)

    # --- Vyhledávání ---

    def najdi_dle_jmena(self, jmeno):
        """Vyhledá zaměstnance přesně podle jména. Vrací objekt nebo None."""
        return self._najdi_rekurzivne(self.koren, jmeno)

    def _najdi_rekurzivne(self, aktualni, jmeno):
        """Rekurzivní BST vyhledávání — O(log n) pro vyvážený strom."""
        if aktualni is None:
            return None  # Jméno v stromu neexistuje
        if aktualni.uzivatel.jmeno == jmeno:
            return aktualni.uzivatel
        elif jmeno < aktualni.uzivatel.jmeno:
            return self._najdi_rekurzivne(aktualni.levy, jmeno)
        else:
            return self._najdi_rekurzivne(aktualni.pravy, jmeno)

    def ziskej_serazene(self):
        """Vrátí seznam všech zaměstnanců seřazený abecedně (in-order průchod)."""
        nalezene = []
        self._in_order(self.koren, nalezene)
        return nalezene

    def _in_order(self, aktualni, seznam):
        """In-order průchod stromem: levý → kořen → pravý = abecední pořadí."""
        if aktualni is not None:
            self._in_order(aktualni.levy, seznam)
            seznam.append(aktualni.uzivatel)
            self._in_order(aktualni.pravy, seznam)

    def over_pripnuti(self, kod, typ):
        """Prohledá celý strom a najde zaměstnance, jehož čip nebo PIN odpovídá kódu.
        
        Na rozdíl od najdi_dle_jmena nelze použít BST vlastnosti stromu —
        hashe čipů nejsou seřazeny, musíme projít všechny uzly.
        """
        return self._over_rekurzivne(self.koren, kod, typ)

    def _over_rekurzivne(self, aktualni, kod, typ):
        """Rekurzivní prohledávání celého stromu pro ověření čipu/PINu."""
        if aktualni is None:
            return None
        
        u = aktualni.uzivatel
        # Ověříme aktuální uzel
        if typ == 'pin' and u.over_pin(kod):
            return u
        if typ == 'cip' and u.over_cip(kod):
            return u

        # Hledáme dál v levém podstromu, pak v pravém
        nalezen_vlevo = self._over_rekurzivne(aktualni.levy, kod, typ)
        if nalezen_vlevo:
            return nalezen_vlevo
        
        return self._over_rekurzivne(aktualni.pravy, kod, typ)

    # --- Mazání ---

    def smaz_uzivatele(self, jmeno):
        """Odstraní zaměstnance ze stromu podle jména a zachová BST vlastnosti."""
        self.koren = self._smaz_rekurzivne(self.koren, jmeno)

    def _smaz_rekurzivne(self, aktualni, jmeno):
        """Rekurzivně najde a odstraní uzel, pak opraví strukturu stromu.
        
        Řeší tři situace:
          1. Uzel nemá potomky → jednoduše ho odstraníme
          2. Uzel má jednoho potomka → nahradíme ho tím potomkem
          3. Uzel má dva potomky → nahradíme ho nejmenším uzlem pravého podstromu
        """
        if aktualni is None:
            return aktualni
        
        # Navigace k hledanému uzlu
        if jmeno < aktualni.uzivatel.jmeno:
            aktualni.levy = self._smaz_rekurzivne(aktualni.levy, jmeno)
        elif jmeno > aktualni.uzivatel.jmeno:
            aktualni.pravy = self._smaz_rekurzivne(aktualni.pravy, jmeno)
        else:
            # Uzel nalezen — řešíme podle počtu potomků
            if aktualni.levy is None:
                # Případ 1 a 2: chybí levý potomek → vrátíme pravého (nebo None)
                return aktualni.pravy
            elif aktualni.pravy is None:
                # Případ 2: chybí pravý potomek → vrátíme levého
                return aktualni.levy
            
            # Případ 3: uzel má oba potomky
            # Najdeme in-order nástupce (nejmenší uzel v pravém podstromu)
            # a přepíšeme jím mazaný uzel, pak nástupce smažeme z pravého podstromu
            docasny = self._najdi_minimum(aktualni.pravy)
            aktualni.uzivatel = docasny.uzivatel
            aktualni.pravy = self._smaz_rekurzivne(aktualni.pravy, docasny.uzivatel.jmeno)
            
        return aktualni

    def _najdi_minimum(self, aktualni):
        """Najde uzel s nejmenší hodnotou (nejlevější uzel podstromu)."""
        while aktualni.levy is not None:
            aktualni = aktualni.levy
        return aktualni