# TRŽIŠTE UŽIVO

[![Deploy to Render](https://render.com/images/deploy-to-render-button.svg)](https://render.com/deploy?repo=https://github.com/sergejzecevicsales-gif/Integracije-igra)

Multiplayer igra za predavanje o tržišnim strukturama, konkurenciji i koncentraciji.
Studenti osnivaju firme na telefonima i 6–7 minuta igraju na tržištu od **10.000 kupaca**,
a profesor na projektoru gleda kako tržište klizi iz konkurencije u oligopol — i nazad.

* **Projektor / računar:** veliki ekran sa tržištem, HHI mjeračem, rang listom i vijestima
* **Telefoni:** svaki student vodi svoju firmu (5 rundi)
* **Bez instalacije, bez baze, bez interneta** — jedan Node.js fajl i statični frontend
* **Demo režim:** dugme „+8 botova“ popuni salu ako nema dovoljno telefona

---

## 1. Brzo pokretanje

1. Instaliraj [Node.js](https://nodejs.org) (LTS). Provjera: `node -v`
2. Dvoklik na **`start.bat`** (ili `npm start`)
3. Otvoriće se ekran za projektor: **`http://localhost:4000/screen`**
4. Na projektoru piše adresa za telefone (npr. `http://192.168.100.10:4000/`) i QR kod
5. Studenti otvore tu adresu, upišu ime firme i kliknu **OSNUJ FIRMU**
6. Kad se svi prijave: **POKRENI IGRU**

> Ako je port 4000 zauzet, server sam prelazi na 4001, 4002… i na ekranu prikaže tačnu adresu.
> Port možeš fiksirati: `set PORT=4100 && node server.js`

### Mreža (najčešći problem)

* Računar i telefoni moraju biti na **istoj Wi-Fi mreži**.
* Prvi put Windows pita za dozvolu firewall-a — klikni **Allow access** (Private networks).
* Ako telefoni ne mogu da se spoje: provjeri firewall, isključi **AP/client isolation**
  na ruteru, isključi VPN, ili napravi hotspot sa telefona i poveži računar na njega.
* Provjera sa telefona: otvori adresu sa ekrana — ako vidiš formu za prijavu, sve radi.

---

## 2. Kako izgleda čas (6–7 minuta)

| Faza | Trajanje | Šta studenti rade | Šta piše na projektoru |
|---|---|---|---|
| Lobi | dok se svi ne prijave | upisuju ime firme | adresa, QR, lista firmi |
| **R1 Borba za kupce** | 25 s | tapkaju i otimaju kupce | krug se dijeli na 30 komada, HHI ~330 (zeleno) |
| **R2 Cjenovni rat** | 20 s | biraju nisku/srednju/visoku cijenu | HHI blago raste, priča o zatvorenikovoj dilemi |
| **R3 Investicije** | 20 s | reklama / inovacija / štednja | otkriva se čije su inovacije uspjele |
| **R4 Spajanja** | 50 s | zovu, pregovaraju, spajaju se | krug se skuplja u par velikih komada, **HHI u crveno** |
| **R5 Komisija** | 25 s | glasaju koju grupu zabraniti | raspad grupe, **HHI pada nazad** |
| Kraj | — | gledaju finale | pobjedničko postolje + graf HHI kroz igru |

Igra je automatska (same prelazi iz runde u rundu), a profesor u svakom trenutku može
da preskoči (`DALJE`), pauzira (`PAUZA`) ili produži objašnjenje.

---

## 3. Pravila po rundama

### Runda 1 — Borba za kupce (25 s)

Svako tapkanje je dio tržišta. Na kraju runde kupci se dijele srazmjerno broju tapkanja
(+ mali bazni udio da niko ne ostane na nuli). 10.000 kupaca, 30 firmi → HHI ≈ 330.

### Runda 2 — Cjenovni rat (20 s)

| Cijena | Zarada po kupcu | Privlačnost kupaca |
|---|---|---|
| **Niska** | 8.000 KM | +70% |
| **Srednja** | 20.000 KM | 0% |
| **Visoka** | 55.000 KM | −38% |

Kupci se preraspodjeljuju prema cijeni (oni sa niskom cijenom uzimaju dio onima sa visokom).
Zamka: **ako svi obore cijenu, niko ne dobija kupce**, a svi zarađuju manje.
Ako svi drže visoku cijenu, svi zarađuju — ali svako pojedinačno ima motiv da obori cijenu.

### Runda 3 — Investicije (20 s)

| Ulaganje | Cijena | Efekat |
|---|---|---|
| **Reklama** | 15 mil | +30% kupaca (na račun drugih) |
| **Inovacija** | 20 mil | 40% šanse da udvostručiš kupce; ako ne uspije, uloženih 20 mil je izgubljeno |
| **Štednja** | 0 | +8 mil kapitala, bez rizika |

Trošak se odbija odmah; ishod inovacije se otkriva na projektoru na kraju runde.

### Runda 4 — Spajanja (50 s)

* **Direktna ponuda** — pošalješ ponudu jednoj grupi; ona prihvata/odbija (12 s).
* **Javni poziv** — pozoveš sve firme; svaka grupa koja prihvati pridružuje se tvojoj (20 s).
  Tako nastaju velike grupe u nekoliko sekundi — zato HHI skače u crveno.
* Grupe se mogu spajati dalje. **Samo lider grupe** šalje i prihvata ponude.
* Spajanje objedinjuje kapital i kupce. Lider ostaje onaj ko je inicirao spajanje.

### Runda 5 — Komisija (25 s)

* Glasa svaka firma, jedan glas, **ne može se glasati za svoju grupu**.
* Na glasačkom listiću su **4 najveće grupe**; zabranjuje se ona sa najviše glasova.
* Zabranjena grupa se **raspada na firme kakve su bile prije spajanja** i plaća kaznu
  od **30% kapitala**.
* Ako jedna grupa drži **više od 60% tržišta**, Komisija je raspada po službenoj dužnosti
  (da priča uvijek ima poentu — tako je i u stvarnoj politici konkurencije).

### Kraj

**Vrijednost firme = kapital + kupci × 100.000 KM.** Pobjednik je grupa sa najvećom
vrijednošću. Na projektoru se prikaže postolje i graf HHI kroz svih 5 rundi, sa pragovima
**1.000** i **2.000** — ista skala kao na slajdu: *„Za 6 minuta napravili ste tržište
od konkurencije do oligopola, i nazad.“*

---

## 4. Admin ekran (`/screen`)

Dugmad u donjoj traci:

| Dugme | Šta radi |
|---|---|
| **POKRENI / DALJE** | pokreće igru / preskače trenutnu fazu |
| **PAUZA** | zamrzava tajmer (i igru) dok pričaš |
| **+8 BOTOVA** | dodaje demo firme u lobiju (samo u lobiju) |
| **NOVA IGRA** | resetuje rezultate, zadržava firme (za ponovno igranje iste grupe) |
| **SAKRIJ** | sklanja admin traku sa projektora |

Prečice na tastaturi: `Space` = dalje · `P` = pauza · `B` = botovi · `R` = nova igra ·
`A` = sakrij traku · `F` = cijeli ekran.

> Admin komande rade samo sa računara domaćina (telefoni ne mogu da upravljaju igrom).

---

## 5. Ekonomija igre (za slajd / odbranu)

Konstante su na vrhu `server.js`:

| Parametar | Vrijednost |
|---|---|
| Početni kapital | 50 mil KM |
| Ukupno kupaca | 10.000 |
| Vrijednost kupca | 0,15 mil KM |
| Pragovi HHI | 1.000 (konkurencija) / 2.000 (oligopol) |
| HHI | `Σ (udio_grupe × 100)²` |

HHI kroz tipičnu igru: **~330–500 → 1.000+ → 4.000–6.000 (crveno) → 800–1.300** poslije Komisije.

---

## 6. Za kodera (arhitektura)

```
server.js            — cijela igra: stanje, pravila, SSE, admin API, botovi
public/
  index.html         — telefon: prijava + igra
  screen.html        — projektor
  common.js          — formatiranje, HTTP, SSE klijent
  player.js          — ekrani po rundama (tap, cijena, investicija, spajanja, glasanje)
  screen.js          — krug tržišta (SVG), HHI mjerač, rang lista, vijesti, finale
  shared.css / screen.css / player.css
tools/
  test-flow.js       — end-to-end test bez browsera (botovi + 3 „telefona“, sve 5 rundi)
  shots.ps1          — snimci ekrana za vizuelnu provjeru
```

* Node.js 18+, **bez ijedne npm zavisnosti**.
* Komunikacija: **SSE** (`/api/events`) za stanje + `POST /api/act` za akcije.
* Stanje se šalje 3–4 puta u sekundi; tajmer se računa lokalno iz `endsAt` + `serverNow`.
* Botovi su serverski igrači sa istim pravilima (`isBot`), pa se demo ponaša kao prava sala.
* Test: `node tools/test-flow.js` (server mora raditi na portu 4000).

### API (kratko)

| Ruta | Opis |
|---|---|
| `POST /api/join` | `{name}` → `{token, id, name, color}` |
| `GET /api/state?token=` | trenutno stanje za igrača |
| `GET /api/events?token=` / `?role=screen` | SSE stream stanja |
| `POST /api/act` | `{token, type, ...}` — `tap`, `price`, `invest`, `offer`, `respond`, `vote` |
| `POST /api/admin` | `{action}` — samo sa localhosta |

---

## 7. Ideje za proširenje (nije implementirano)

* **Tajni kartel** — dvije firme se dogovore o visokim cijenama; ako Komisija otkrije, kazna.
* **Iznenadni događaj** između rundi — kriza (−10% kapitala svima) ili ulazak stranog igrača.
* **Veto Komisije** — profesor poništava jednu odluku sale.
* **Asimetrične firme** — različiti početni kapitali ili troškovi („stara“ vs „nova“ firma).

---

## 8. Snimci ekrana

![Projektor — runda 4, spajanja](shots/11-round4.png)
![Telefon — ponude za spajanje](shots/12-phone-merge.png)
![Finale — HHI kroz igru](shots/17-final.png)

Svi snimci (lobi, sve runde, rezultati, finale) su u folderu `shots/`.

---

## 9. Scenarij za prezentaciju (2 minute prije + 6 minuta igre)

1. **Uvod:** „Svako od vas je firma sa 50 miliona KM. Na tržištu je 10.000 kupaca. Cilj je
   da na kraju imate najvredniju firmu — kapital plus kupci.“
2. **R1:** pokaži krug podijeljen na 30 komada i zeleni HHI: „Ovo je konkurencija —
   mnogo malih firmi, niko nema moć.“
3. **R2:** poslije runde pročitaj ko je oborio cijenu: „Ovo je zatvorenikova dilema.
   Niska cijena je isplativa pojedincu — dok je svi ne izaberu.“
4. **R3:** otkrij inovacije: „Inovacija je rizik. Reklama je sigurna, ali skuplja po kupcu.“
5. **R4:** Dok se spajaju, pričaj o koncentraciji: „Krug se skuplja, HHI ide u crveno.“
6. **R5:** Komisija: „Isti problem kao u stvarnosti — kako kazniti firmu koja je prevelika?“
7. **Finale:** graf HHI: „Za šest minuta prošli ste cijelu priču sa slajda: od konkurencije
   do oligopola — i nazad. To je ono što radi politika konkurencije.“

---

## 10. Postavljanje na internet (hosting)

Igra je **stalni Node proces**: drži stanje u memoriji i SSE vezu sa svim telefonima.
Zato joj treba host koji podržava dugotrajne servere.

> ⚠ **Vercel ne može da pokrene ovu igru.** Vercel Functions su serverless: nemaju
> zajedničku memoriju između zahtjeva i prekidaju duge veze, pa bi igra „pukla“ na pola
> časa. Vercel je dobar za statične stranice, ne za ovakav realtime server.

### Render (preporučeno — besplatno, login preko GitHub-a)

1. [render.com](https://render.com) → **Sign up with GitHub**
2. **New +** → **Blueprint** → izaberi repo `Integracije-igra` → **Apply**
   (sve je već opisano u `render.yaml`)
3. Sačekaj build (~1 min) → dobiješ `https://trziste-uzivo.onrender.com`
4. Projektor: `https://trziste-uzivo.onrender.com/screen`; telefoni idu na adresu sa ekrana

Napomene:

* `PORT` i javna adresa se postavljaju automatski (`RENDER_EXTERNAL_URL`).
* Free instanca spava poslije 15 min neaktivnosti — prvo otvaranje traje ~30 s.
* Zaštita admina: dodaj env `ADMIN_PIN=1234` i otvori `/screen?pin=1234`
  (PIN se zapamti u browseru; bez toga admin ekran može otvoriti svako ko zna `/screen`).
* Isto radi na **Railway** i **Fly.io**: start komanda `node server.js`, port iz `PORT`.
  Za custom domenu postavi `PUBLIC_URL=https://tvojdomen` (koristi se za QR i adresu).

### Vercel — šta bi značilo

Da bi radilo na Vercelu, trebalo bi napisati drugu verziju servera:
serverless funkcije + eksterna baza (Vercel KV/Upstash) + polling umjesto SSE + zaključavanje
stanja. To je poseban projekat i troši dnevne kvote baze pri svakoj igri.
Ako baš treba link na Vercelu, može samo **statični demo ekrana** (bez telefona) — reci pa
napravim.

---

