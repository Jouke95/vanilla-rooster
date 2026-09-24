# Ideeën voor het rooster

Verzameld op 23 september 2026. Nog niet gebouwd tenzij anders vermeld.

## Feedback Bennie (24 september 2026)

- **Minder scrollen bij slepen** — het gaat om naar beneden scrollen. Idee: rij "Niet toegewezen" bovenaan in beeld houden, rijen compacter.
- **Status "Ziek"** — aparte status, zie ook Ziekmelding hieronder.
- **Productie als aparte groep** — werkt grotendeels als het magazijn (diensten met tijden, standaardrooster).
- **Print in kleur, staand** — magazijn lichtblauw, chauffeur lichtgroen, productie lichtgeel, vakantie oranje, ziek rood; niet werken = wit met "–"; tekst zwart; dagen smaller.

## Chauffeurs

- **Vaste chauffeur per route** — *Gebouwd (24 sep 2026):* "Deze week als standaardrooster opslaan" en "Standaardrooster invullen"; nieuwe weken worden automatisch ingevuld.
- **Ziekmelding** — aparte status "Ziek" (naast vakantie en niet beschikbaar), ook voor meerdere dagen. Routes gaan automatisch terug naar "Niet toegewezen". Werkt ook voor het magazijn.
- **Voertuig per route** — kenteken per route, met een waarschuwing als hetzelfde voertuig op één dag dubbel staat.
- **Vorige week kopiëren** — toewijzingen van vorige week overnemen als startpunt.

## Magazijn

- **Minimale bezetting** — per dag een minimum aantal mensen; rood als er te weinig ingepland staan.
- **Notitie per dienst** — korte opmerking, bijv. "komt om 9:00, tandarts".
- **Contracturen** — ingepland tegenover contract per persoon. *Uitgesteld: contractgegevens nog niet bekend.*

## Algemeen

- **Notitie per dag** — bijv. "extra levering" of "inventarisatie", zichtbaar op beide tabbladen en de print.
- **Zaterdag** — zesde dag, eventueel alleen tonen als er iets op staat.
- **Overzicht dubbele inplanning** — lijstje "deze week dubbel ingepland: Bert (di)" onder het rooster.
- **Leesversie voor personeel** — eenvoudige pagina (ook op de telefoon) waar medewerkers alleen hun eigen rooster zien.

## Onderhoud

- **Vaste React-versie** — nu de ontwikkelversie via unpkg met alleen "versie 18"; vastzetten op een productieversie.
- **Nieuwe week sneller openen** — vaste routes in één keer door de server laten aanmaken in plaats van ~30 losse verzoeken.

## Niet nodig

- **Urenoverzicht voor salaris** — gebeurt al via het kloksysteem (vingerafdruk).
- **Goede Vrijdag en Bevrijdingsdag als feestdag** — bewust niet meegenomen.
