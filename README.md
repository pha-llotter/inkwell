# Inkwell

Captures a person's signature on any device and gives you back a clean,
transparent PNG to drop into your management system.

The whole form is: name, surname, sign. Nothing else is asked for.

```
npm install
cp .env.example .env        # then fill in SESSION_SECRET
npm start                   # http://localhost:3100
```

First visit creates the single administrator account. `npm run check` runs a
22-assertion end-to-end test in a real browser with touch input.

---

## How it works

**The capture page is at `/` and open to anyone with the link.** No account, no
token. Someone types their name, signs with a finger or stylus, sees how it will
be saved, and confirms. The page then resets for the next person, so one device
can be handed down a queue.

**The administrator signs in at `/login`** and is the only one who can see or
download anything. There is one account by design — no roles, nothing to
escalate to. The setup page disappears once it exists.

**Output** is a transparent PNG, trimmed to the ink, rendered at three times the
captured size so it stays crisp when placed or printed. Download them one at a
time, or all at once as a ZIP. Filenames are `surname-name-id.png`.

## The smoothing

This is the part worth explaining, because it is the reason the signatures look
like a pen rather than a finger-drawn scrawl.

**No machine-learning model is involved, deliberately.** Smoothing a signature
is a geometry problem with a known answer, and curve fitting beats a learned
model here: it is instant, predictable, has nothing to download, and — most
importantly for something used as a record — it never invents a stroke the
person did not make.

`public/js/ink.js` does this, in order:

1. **Drop duplicate samples.** Touchscreens report the same coordinate many
   times while a finger rests. Left in, they make the speed estimate read as
   zero and blob the stroke.
2. **Low-pass the positions.** A symmetric moving average removes finger
   tremor. The endpoints are preserved exactly, so the signature neither shrinks
   nor drifts from where it was drawn.
3. **Measure speed** at every point, from the distance and time between
   neighbours.
4. **Turn speed into stroke width.** Fast is thin, slow is thick. A pen lays
   down more ink where the hand slows: at the start of a stroke, in tight turns,
   at the end. This single step is most of what separates ink from a drawn
   cable.
5. **Low-pass the widths too**, or the stroke visibly pulses, and taper the
   ends so a stroke lifts off rather than stopping square.
6. **Draw as Catmull-Rom curves**, as a filled ribbon between two offset edges.
   Stroking a path cannot vary its width along its length, which is exactly the
   effect wanted.

`npm run ink-preview` renders the same strokes raw and smoothed side by side, so
the effect can be judged by eye rather than taken on trust.

**The raw points are kept** alongside every image, with their timestamps. If you
ever want a signature at a different size, colour or line weight, it can be
redrawn from the original without asking the person back. It is also the only
record of how the signature was actually made.

## The capture page is open, by choice

That was a deliberate decision, and these are the limits that keep it from
becoming a liability without putting anything in front of someone signing:

- **20 submissions per IP per hour**, configurable. Counted on *every*
  submission, not only the ones that succeed — counting only successes would
  leave someone sending junk entirely unthrottled, which is the case the limit
  exists for.
- **A honeypot field**, hidden from people and from screen readers. When it is
  filled in the server answers as though it worked, so a bot learns nothing.
- **Every capture records the IP, time and user agent**, so junk is traceable.
- **Images are validated before they are written** — the PNG magic bytes are
  checked, not just the content type.
- The administrator can delete anything.

If this ever goes somewhere public, the better answer is one-time links per
person. The structure is here for it.

## Layout

```
src/
  server.js       express app, sessions, static mounts
  config.js       env, secrets, storage paths, capture limits
  db.js           sqlite connection
  schema.sql      users, signatures, capture_attempts
  zip.js          a minimal store-only ZIP writer, so the bulk download
                  needs no dependency (PNGs are already compressed)
  routes/         auth (single admin), capture (public), admin
public/js/
  ink.js          the smoothing and rendering pipeline
  capture.js      the capture page
scripts/
  check.js        end-to-end test, real browser, touch input
  ink-preview.js  raw vs smoothed comparison
  backup.ps1      restorable checkpoint, outside the project
  restore.ps1     safe by default, restores alongside
```

## Backups and version control

**Git tracks the code. It does not track `storage/` or `.env`** — captured
signatures are real people's personal data, and committing a secret once
publishes it even if a later commit removes it.

**Zip checkpoints cover what git does not.** `scripts\backup.ps1` archives the
code, `.env` and `storage/` together, outside the project folder. Those archives
contain personal data and should be protected like the server itself.

So: git to undo a change, a checkpoint to recover an installation.

## Not built

One-time capture links, bulk CSV export of the name list, an API for your
management system to pull from, and re-rendering stored strokes at a new size
from the admin page. The data model already supports the last one.
