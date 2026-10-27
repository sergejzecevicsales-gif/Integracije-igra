# Tržište uživo — pregovori i samostalnost

Igra za 10–12 minuta u kojoj učesnici vode različite internet firme, pregovaraju o ugovorima i spajanjima, prodaju ili zadržavaju kontrolu, a zatim postaju kupci na tržištu koje su sami napravili.

## Pokretanje i vođenje

- `npm start` ili dvoklik na `start.bat`. Projektor: `http://localhost:4000/screen` (ili port ispisan u prozoru servera).
- Telefoni skeniraju lokalno generisan QR kod ili otvore adresu sa projektora. Pri otvaranju firme obavezno se unose ime, prezime i naziv firme. Ime i prezime se prikazuju uz firmu u lobiju, listi za pregovore, ponudama i vlasničkoj strukturi, kako bi učesnici znali s kim pregovaraju. Za lokalnu igru koristite istu Wi-Fi mrežu. Najmanje 3, najviše 60 firmi.
- **Kontrole → +8 demo firmi** za probu. Demo firme prihvataju ponude prema istim pravilima; međusobno pregovaraju bez prisilnog spajanja ljudi.
- Domaćin završava svaku aktivnost i svako otkrivanje. Vrijeme je preporuka, nema automatskog prekida pregovora.
- Space aktivira glavno dugme, P pauzira, A skriva kontrole, B dodaje demo firme u lobiju, F otvara cijeli ekran.
- **Nova igra · iste firme** briše rezultate i čuva prijave. **Isprazni salu** briše i prijave; telefoni se vraćaju na ulaz.

## Tok za 10–12 minuta

| Korak | Aktivnost | Potez i koncept |
|---|---|---|
| 1 | Početni potez, 45 s | Uloži u efikasnost ili čuvaj gotovinu za preuzimanja. Likvidnost i oportunitetni trošak. |
| 2 | Prvi pregovori, 2 min | Dogovorite udio i novac odmah. Ponuda prikazuje procjenu ličnog dobitka, uz gubitak ili zadržavanje kontrole. |
| 3 | Prvi poslovni mjesec, 30 s | Vlasnici biraju cijenu. Stvarni profit se isplaćuje članovima i pojavljuje na leaderboardu. |
| 4 | Objavi uslove, 40 s | Nezavisni vlasnici objavljuju koliko udjela i gotovine traže za novi dogovor. Pregovaračka moć i rezervacioni uslovi. |
| 5 | Završni pregovori, 2 min | Koristi već zarađeni novac, uporedi računicu i otkupi preostale rivale ako se dogovor isplati. |
| 6 | Drugi poslovni mjesec, 30 s | Preostali vlasnici opet biraju cijenu. Druga isplata pokazuje promjenu zarade i tržišne moći. |
| 7 | Otvaranje tržišta, 20 s | Strani ponuđač ulazi s paketom 40 KM. Uporedi domaći profit, cijene i dostupnost. |

Između koraka domaćin otkriva posljedice i može zastati za kratko objašnjenje. Uklonjeni su anketa o tome žele li učesnici živjeti na tržištu i pojedinačna kupovina interneta. Fokus je na ličnoj finansijskoj koristi i tome kako prihvaćeni dogovori uklanjaju nezavisne rivale.

Ne nameći ishod. Ako učesnici ne prihvate ponuđene uslove, na tržištu ostaje više firmi. Igra modelira podsticaje za koncentraciju, a ne univerzalnu tvrdnju da svako tržište mora postati monopol. U ovom pojednostavljenom modelu jedan vlasnik znači monopol, a 2–5 vlasnika označeno je kao oligopol.

## Lični dohodak na svakom koraku

Na vrhu telefona, iznad novca firme, stalno je **Lični dohodak**: stvarno isplaćeni zbir udjela u profitu. Ispod njega su prosjek po završenom poslovnom mjesecu, raspoloživi novac firme i sažetak efekta trenutnog koraka. Gotovinske isplate iz dogovora ostaju posebno prikazane: one nisu mjesečni dohodak.

- Ulaganje pokazuje procjenu dohotka prije i poslije ulaganja, te gotovinu koju firma sada troši.
- Nacrt ponude i kontraponude prikazuje računicu prije slanja. Pregled ne šalje ponudu, ne rezerviše sredstva i ne mijenja novac.
- Potvrđeni dogovor prikazuje promjenu ličnog udjela, gotovine i procjene dohotka uz cjenovni plan iz ponude.
- Svaka ponuđena cijena pokazuje procjenu vlastitog dohotka. Cijene rivala uzimaju se iz posljednjeg objavljenog kruga ili kao 40 KM prije prve prodaje; tuđi tajni izbori ne ulaze u pregled.
- Objavljivanje traženih uslova nema isplatu dok neko ne prihvati ponudu.
- Obračun mjeseca pokazuje stvarnu pripadajuću isplatu i promjenu u odnosu na prošli mjesec.
- Strani ulazak prikazuje poređenje budućeg dohotka, bez mijenjanja već isplaćenog novca.

## Kako se ponašaju demo firme

Demo firme uzimaju nekoliko sekundi za odluku i ostavljaju vrijeme ljudima da odgovore. Ponude šalju i ljudima. Biraju među dostupnim partnerima prema računici ličnog rezultata; dijele očekivanu korist tako da ponuda može biti prihvatljiva objema stranama i poštuju raspoloživi novac. Ne šalju niz ponuda dok se čeka postojeći dogovor.

Demo firma prihvata ponudu ako ona prema vidljivoj računici ne smanjuje njen lični rezultat i kupac može platiti. Za nepovoljnu ponudu traži bolje uslove, a odbija je ako ne nalazi izvediv dogovor. Uz odgovor se prikazuje kratko obrazloženje. Bot ne odgovara sam sebi, ne odlučuje umjesto ljudskog vlasnika i pri izboru cijene ne koristi tuđe tajne izbore.

## Lična računica i leaderboard

Svaka ponuda za spajanje prikazuje poređenje bez dogovora i s dogovorom za svakog člana dvije grupe. Procjena uključuje jednu narednu mjesečnu isplatu i gotovinu koja se plaća odmah. Računa se najbolja dostupna cijena nove grupe, uz nepromijenjene sadašnje cijene rivala; prije prve prodaje, kada cijene nisu poznate, koristi se pretpostavka 40 KM. Prikazuju se i procijenjeni gubitnici među članovima. Prognoza nije obećana isplata: naredne odluke o cijeni i novi dogovori mogu promijeniti ishod.

Leaderboard prikazuje:

- **Lični dobitak:** raspoloživi novac firme minus početni novac. Uključuje ulaganja, gotovinu plaćenu ili primljenu pri spajanjima i stvarno isplaćene udjele profita.
- **Prosječnu mjesečnu zaradu:** zbir isplaćenih udjela profita podijeljen brojem završenih poslovnih mjeseci. Ovo je zarada učesnika iz igre, ne stvarna plata zaposlenih; kupoprodajne isplate nisu mjesečna zarada.
- Prosjek mjesečne zarade cijele sale. Prije prve isplate mjesečna zarada je 0 KM.

U drugom krugu pregovora, ciljna grupa može objaviti traženi udio i gotovinu. To su početni, neobavezujući uslovi. Kupac ne može ponuditi novac koji nema i može umjesto njega ponuditi veći udio. Objavljena tražena cijena prodavca ne mora biti manja od njegovog vlastitog novca: to nije trošak koji prodavac obećava platiti.

## Firme i prvi potez

Tri tipa se ravnomjerno smjenjuju pri pokretanju:

| Prednost | Osnovni trošak po kupcu | Težina pri istoj cijeni | Početni novac |
|---|---|---|---|
| Kupci | 26 KM | 3 | Jedna jedinica |
| Infrastruktura | 14 KM | 1 | Jedna jedinica |
| Kapital | 22 KM | 1 | Tri jedinice |

Jedna novčana jedinica iznosi 180.000 KM podijeljeno brojem firmi. Ulaganje košta 90.000 KM podijeljeno brojem firmi i trajno smanjuje osnovni trošak te firme za 6 KM. Druga opcija je čuvanje novca. Odluka je zaključana nakon slanja. Početni novac se oduzima pri rangiranju, pa se veći početni kapital ne prikazuje kao zarađeni profit.

## Pregovori: stvarni uslovi i posljedice

**Spajanje:** inicijator nudi drugoj grupi 10–70% udjela, u koracima od 5%, i opcionalnu isplatu odmah iz novca svoje firme. Ponuda pokazuje lični udio nakon spajanja, gotovinu, ime osobe koja zadržava kontrolu i novi trošak. Druga strana može prihvatiti, odbiti ili poslati kontraponudu za udio i novac. Kontraponuda ne zamjenjuje osobu koja bi zadržala kontrolu. Ovako firma s kapitalom može ponuditi više novca sada, a zadržati veći dio budućeg profita.

Nakon prihvatanja inicijator zadržava ugovoreno pravo upravljanja, nezavisno od svog procenta udjela. Druga grupa gubi pravo postavljanja samostalne cijene. Postojeći udjeli obje grupe proporcionalno se prilagođavaju, a ukupno ostaje 100%. To je pojednostavljeno, unaprijed prikazano pravilo igre. Kasnija spajanja mogu dodatno smanjiti procenat udjela ranijih članova; pregovara osoba koja ima kontrolu. Dogovorena gotovina se naplaćuje kontrolnom vlasniku koji je poslao ponudu i dijeli članovima druge grupe prema njihovim prethodnim udjelima. Novac se prenosi, ne stvara. Ako ponuđač više nema dovoljno novca, ponuda se ne može prihvatiti bez novih uslova.

Spojena grupa može koristiti najjeftiniju dostupnu infrastrukturu svojih članova, pa je njen osnovni trošak najmanji operativni trošak člana. Kapacitet infrastrukture u ovom modelu nije ograničen. Grupa koja ima i tip Kupci i tip Infrastruktura dodatno štedi 4 KM po kupcu, jednom, uz donju granicu troška 8 KM. Spajanje samo po sebi ne stvara kupce.

**Ugovor o infrastrukturi:** barem jedna strana mora imati tip Infrastruktura. Korisnik ugovora smanjuje operativni trošak do 8 KM, uz donju granicu 8 KM, i plaća vlasniku mreže dogovorenu naknadu od 2, 4 ili 6 KM po svom kupcu. Obje firme zadržavaju kontrolu. Ponuda prikazuje stvarnu neto uštedu korisnika. Ako obje strane imaju infrastrukturu, ciljna strana iznajmljuje mrežu inicijatoru. Novi ugovor zamjenjuje prethodni ugovor korisnika.

Aktivni ugovori se prenose kroz kasnija spajanja. Unutrašnji ugovor iste grupe se gasi, a grupa s više vanjskih ugovora zadržava onaj s najmanjom naknadom. Dopuštene su najviše tri istovremene izlazne ponude po grupi. Promjena vlasništva poništava stare neprihvaćene ponude koje su se oslanjale na raniji sastav firme, pa nije moguće istu firmu prodati dvaput. Preostale ponude ističu kada domaćin zaključi pregovore.

## Cijene, kupci i novac

- Samo kontrolni vlasnik postavlja jednu cijenu: 30, 40, 50, 60, 80 ili 100 KM. Na telefonu vidi broj domaćinstava koji taj iznos može priuštiti. To nije garantovana prodaja: jeftiniji rival može osvojiti kupce.
- 10.000 domaćinstava ima fiksne budžete: 1.000 po 30 KM, 1.500 po 40 KM, 1.500 po 50 KM, 2.000 po 60 KM, 2.500 po 80 KM i 1.500 po 100 KM.
- Domaćinstva biraju najnižu pristupačnu cijenu. Kod iste cijene dijele se prema težini kupaca firmi; kod spajanja se težine sabiraju. Nema kapacitetskih ograničenja ili troška prelaska.
- Ako vlasnik ne odabere cijenu, koristi se 50 KM i to se označava pri otkrivanju.
- Profit = (cijena − operativni trošak − vanjska naknada za mrežu) × kupci, uz prihod od iznajmljivanja infrastrukture. Naknade su transfer između firmi, ne dodatni novac.
- Profit se jednom po završenom poslovnom mjesecu isplaćuje članovima prema prihvaćenim udjelima, uz očuvanje svih centi. Finansijski rezultat = novac na kraju − početni novac. Ulaganje je stvarni trošak; gotovinske ponude prenose novac između firmi. Ulazak stranog operatera ne naplaćuje se učesnicima.
- Budžeti simuliranih kupaca odvojeni su od novca firmi. Učesnici pregovaraju kao vlasnici i ne popunjavaju potrošačku anketu.

## Otvaranje tržišta i strani operater

Nakon drugog poslovnog mjeseca domaćin najavi otvaranje tržišta. Strani operater ulazi s istim paketom za 40 KM, troškom 20 KM i težinom kupaca 1. Ulazak je dio scenarija ekonomske integracije: nema prikupljanja novca niti troška za učesnike.

Postojeće domaće cijene i budžeti kupaca ostaju isti. Igra ponovo računa izbor kupaca, profit domaćih firmi i dostupnost interneta. Na telefonu se vidi i poređenje ličnog udjela u profitu. Ovaj prikaz ne isplaćuje dodatni profit i ne mijenja već zarađeni novac; služi poređenju prije i poslije ulaska. Ako su domaće firme već ponudile cijenu nižu od 40 KM, novi operater neće automatski osvojiti kupce.

## Tehničke provjere i hosting

`npm test` provjerava različite uloge, ulaganje, kontraponude, kontrolu, razrjeđivanje udjela, konkurentne ponude, ugovore i transfere novca, potrošačke budžete, bezuslovni ulazak stranog operatera bez naplate, obavezna imena i prezimena, čuvanje stanja, reset i botove.

`npm run test:flow` provjerava cijeli tok na izolovanom serveru. Koristi `PORT` ili `BASE_URL`; provjera resetuje ciljnu salu i namijenjena je lokalnoj probi. Za lokalnu polling varijantu: `node tools/serverless-dev.js` (port 4200).

Lokalno radi postojeći SSE transport, a na Vercelu polling i Neon/Redis skladište. QR kod se generiše lokalno. `ADMIN_PIN` se unosi u Kontrole ili preko `/screen?pin=...`. Za lokalni pristup telefonima može biti potrebna Windows firewall dozvola za privatnu mrežu.

Format stanja je verzija 7. Stara igra nije kompatibilna i otvara novu salu. Ranija lokalna verzija sačuvana je u `.local-backup/before-negotiation-redesign/`. Promjene nisu objavljene na javnom hostingu dok se ne izvrši deployment.
