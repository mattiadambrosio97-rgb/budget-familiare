# Budget familiare

Indirizzo: https://mattiadambrosio97-rgb.github.io/budget-familiare/

## Come si usa

- **Il sistema**: portafoglio (Fineco più tutti i contanti) da 1.370 € al mese e cassaforte (Tinaba) per imposta, scadenze e risparmio. Il primo del mese un solo bonifico, calcolato da Claude, riporta il portafoglio a 1.370 €.
- **Le spese si registrano in chat con Claude**: una frase, la foto di uno scontrino, uno screenshot di Fineco o un estratto. Claude usa la skill `budget-familiare` (`references/registra-movimenti.md`).
- **L’app mostra i numeri**: quanto puoi spendere oggi in spese libere, le barre di spesa e benzina, il mese, la cassaforte, le scadenze e le entrate attese. La pagina «Come funziona» mostra budget, fisse e scadenze in sola lettura.
- **Se Claude non è raggiungibile**: in app «Da processare» lasci una nota o una foto; poi a Claude dici «processa tutto».
- **Il modulo manuale** resta come riserva e funziona anche offline.

## Come funziona

- `index.html`, `app.js`, `styles.css`, `sw.js`: la PWA, pubblicata su GitHub Pages.
- `calcoli.js`: tutti i calcoli (`quadro`, `bonificoInizioMese`, `diagnosi`), usati dall’app e dallo script. Test: `node --test test/calcoli.test.mjs`.
- `coda.js`: la coda offline. Dati su `/budget-inbox` (voci e foto separate).
- `C:\Users\matti\.claude\skills\budget-familiare\scripts\budget_dati.py`: lettura e scrittura da chat.
- Firebase `/budget`: ogni chiave è una stringa JSON, con `_ts` globale.
  - `movements`, `recurring`: scritte dall’app e dallo script, con merge per id.
  - `settings`, `scadenze`, `cassaforte`, `incomeItems`, `installments`, `taxPayments`: scritte solo dallo script; l’app le legge.
  - `caps`, `sinking`, `income`, `anchor`: chiavi del sistema vecchio, non più lette. Si cancellano solo col sì di Mattia.
- `_backup\`: copia locale di `/budget` prima di ogni scrittura da chat, ultime 30, fuori da git. `_anteprima\`: pagine di prova senza login, fuori da git.

## Regole di calcolo

- **Spese libere di oggi**: budget delle spese libere meno lo speso prima di oggi, diviso i giorni rimasti, oggi compreso; poi meno lo speso di oggi. La quota non scende sotto zero, il resto del mese sì.
- **Il mese**: 1.370 € meno le spese del portafoglio (variabili e fisse) e le fisse ancora da uscire. Una fissa è prevista finché non arriva la spesa collegata (`recurringId` nello stesso mese); se non arriva, a fine mese non conta. Le previste si calcolano dalla lista `recurring`: non sono movimenti.
- **Cassaforte**: saldo dichiarato di Tinaba più o meno i bonifici registrati, più le entrate e meno le spese della cassaforte arrivate dopo l’ultimo bonifico. Destinato: riserva per l’imposta (base 355 € più il 12% delle entrate lorde, meno l’imposta pagata), scadenze non pagate e non finanziate dei prossimi 12 mesi, risparmio (200 € al mese da dicembre 2026). Libero: saldo meno destinato.
- **Bonifico di inizio mese**: 1.370 − (Fineco + contanti − scadenze finanziate e non pagate) + scadenze del mese nuovo (anche scadute) + imposta del mese. Positivo: da Tinaba a Fineco; negativo: da Fineco a Tinaba.
- Le entrate attese non entrano in nessun numero. Prima di `settings.avvio` (1/12/2026) l’app mostra solo cassaforte, scadenze ed entrate.

## Attenzione quando si cambia

- Le categorie stanno in `CATEGORIES` in `app.js` e in `CATEGORIE_APP` in `budget_dati.py`: vanno cambiate insieme; un test dello script controlla che siano uguali.
- A ogni modifica dei file dell’app, aumentare `CACHE_NAME` in `sw.js`.
- Limite noto: il salvataggio di emergenza alla chiusura dell’app non può unire prima i dati del server. Se un telefono con spese non ancora inviate si chiude nell’istante in cui Claude scrive, la scrittura di Claude può andare persa; resta nel backup. La finestra è molto piccola.
- Il push dell’app è un PATCH: non deve mai tornare a essere un PUT su tutto il nodo, che cancellerebbe le chiavi dello script.
