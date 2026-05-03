from abc import ABC, abstractmethod
from werkzeug.security import generate_password_hash, check_password_hash

# =====================================================================
# ABSTRAKTNÍ ZÁKLADNÍ TŘÍDA
# =====================================================================

class Osoba(ABC):
    """Abstraktní základ pro všechny osoby v systému.
    
    Nelze vytvořit přímo — slouží pouze jako šablona pro potomky.
    Vynucuje implementaci __repr__ u každé odvozené třídy.
    """
    def __init__(self, id_osoby, jmeno, role):
        self.id = id_osoby
        self.jmeno = jmeno
        self.role = role

    @abstractmethod
    def __repr__(self):
        """Abstraktní metoda vynucující textovou reprezentaci u potomků."""
        pass


# =====================================================================
# ZAMĚSTNANEC — BĚŽNÝ UŽIVATEL SYSTÉMU
# =====================================================================

class Zamestnanec(Osoba):
    """Reprezentuje běžného zaměstnance s přístupem přes čip nebo PIN.
    
    Hesla a čipy jsou ukládány pouze jako hash — původní hodnoty
    systém nezná a nelze je zpětně získat.
    """
    def __init__(self, id_osoby, jmeno, role, cip, pin, hlaska_prichod="", hlaska_odchod=""):
        super().__init__(id_osoby, jmeno, role)
        
        # PIN musí být právě 4 číslice (pokud je vůbec zadán)
        if pin and (not pin.isdigit() or len(pin) != 4):
            raise ValueError(f"PIN musí být 4místné číslo, dostali jsme: '{pin}'")
        
        # Ukládáme pouze hashe, nikdy samotné hodnoty
        self.cip_hash = generate_password_hash(cip) if cip else None
        self.pin_hash = generate_password_hash(pin) if pin else None
        
        # Volitelné uvítací/rozlučkové hlášky zobrazené na terminálu
        self.hlaska_prichod = hlaska_prichod
        self.hlaska_odchod = hlaska_odchod

    # --- Ověřovací metody ---

    def over_pin(self, zadany_pin):
        """Porovná zadaný PIN s uloženým hashem. Vrací True při shodě."""
        if not self.pin_hash:
            return False
        return check_password_hash(self.pin_hash, zadany_pin)

    def over_cip(self, zadany_cip):
        """Porovná kód čipu s uloženým hashem. Vrací True při shodě."""
        if not self.cip_hash:
            return False
        return check_password_hash(self.cip_hash, zadany_cip)

    def __repr__(self):
        return f"<Zamestnanec id={self.id} jmeno='{self.jmeno}' role='{self.role}'>"


# =====================================================================
# ADMINISTRÁTOR — ROZŠÍŘENÝ ZAMĚSTNANEC S PŘÍSTUPEM DO SPRÁVY
# =====================================================================

class Admin(Zamestnanec):
    """Rozšiřuje Zamestnanec o přihlašovací údaje do webové administrace.
    
    Může se přihlásit třemi způsoby:
      - čipem nebo PINem (zděděno od Zamestnanec) — přístup z terminálu
      - webovým heslem (username/email + heslo) — přístup přes prohlížeč
    """
    def __init__(self, id_osoby, jmeno, role, cip, pin, email, username, heslo, hlaska_prichod="", hlaska_odchod=""):
        super().__init__(id_osoby, jmeno, role, cip, pin, hlaska_prichod, hlaska_odchod)
        
        # Přihlašovací údaje pro webové rozhraní
        self.email = email
        self.username = username
        self.heslo_hash = generate_password_hash(heslo) if heslo else None

    def over_heslo(self, zadane_heslo):
        """Porovná webové heslo s uloženým hashem. Vrací True při shodě."""
        if not self.heslo_hash:
            return False
        return check_password_hash(self.heslo_hash, zadane_heslo)

    def __repr__(self):
        return f"<Admin id={self.id} jmeno='{self.jmeno}' username='{self.username}'>"