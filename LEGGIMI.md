# Budget familiare

Indirizzo: https://mattiadambrosio97-rgb.github.io/budget-familiare/

## Come si usa

- **Le spese si registrano in chat con Claude**: una frase, la foto di uno scontrino o un estratto conto. Claude usa la skill `budget-familiare` (`references/registra-movimenti.md`).
- **L’app mostra i numeri**: quanto puoi spendere fino a fine mese, chiusura di oggi e di ieri, soldi, riserva tasse, entrate attese, diagnosi.
- **Se Claude non è raggiungibile**: in app «Da processare» lasci una nota o una foto; poi a Claude dici «processa tutto».
- **Il modulo manuale** resta come riserva e funziona anche offline.

## Come funziona

- `index.html`, `app.js`, `styles.css`, `sw.js`: la PWA, pubblicata su GitHub Pages.
- `calcoli.js`: tutti i calcoli, usati dall’app e dallo script. Test: `node --test test/calcoli.test.mjs`.
- `coda.js`: la coda offline. Dati su `/budget-inbox` (voci e foto separate).
- `C:\Users\matti\.claude\skills\budget-familiare\scripts\budget_dati.py`: lettura e scrittura da chat.
- Firebase `/budget`: ogni chiave è una stringa JSON, con `_ts` globale.
  - `movements`, `recurring`, `caps`, `sinking`, `income`: scritte dall’app, con merge per `movements`, `recurring`, `sinking`, `income`.
  - `anchor`, `settings`, `incomeItems`, `installments`, `taxPayments`: scritte solo dallo script; l’app le legge.
- `_backup\`: copia locale di `/budget` prima di ogni scrittura da chat, ultime 30, fuori da git.

## Regole di calcolo

- `puoiSpendere` è il minimo fra quanto resta dei tetti e `soldi ora − impegni del mese`.
- Le entrate contano solo quando arrivano. La quota tasse delle entrate lorde va nella riserva.
- La carta pesa dal giorno dell’acquisto; ogni rata nel suo mese.
- «Arrivi fino al» divide i soldi ora per la spesa di riferimento (`settings.autonomyMonthlySpend`, 1.700 € al mese se assente), senza contare le entrate attese.

## Attenzione quando si cambia

- Le categorie stanno in `CATEGORIES` in `app.js` e in `CATEGORIE_APP` in `budget_dati.py`: vanno cambiate insieme.
- A ogni modifica dei file dell’app, aumentare `CACHE_NAME` in `sw.js`.
- Limite noto: il salvataggio di emergenza alla chiusura dell’app non può unire prima i dati del server. Se un telefono con spese non ancora inviate si chiude nell’istante in cui Claude scrive, la scrittura di Claude può andare persa; resta nel backup. La finestra è molto piccola.
- Il push dell’app è un PATCH: non deve mai tornare a essere un PUT su tutto il nodo, che cancellerebbe le chiavi dello script.
