-- Was auf dem Anrufbeantworter gesagt wurde, in Worten.
--
-- Diese Spalte stand schon einmal in `20260918130000_profile_orders.sql` und
-- wurde wieder herausgenommen, weil es keinen Schreiber für sie gab. Eine
-- Spalte ohne Schreiber bleibt für immer leer und sieht dabei aus wie ein
-- Feature; `check-wiring.mjs` meldet genau das. Jetzt kommt sie zusammen mit
-- ihrem Schreiber: `n8n-workflows/webhooks/voicemail-transcribe.json`.
--
-- Warum überhaupt: eine Sprachnachricht, die nur als Link im Ticket steht,
-- muss jemand anhören, bevor er weiß, ob sie eilt. Verschriftet steht sie in
-- derselben Liste wie jeder Chat, ist durchsuchbar und lässt sich überfliegen.

alter table public.calls
  -- Obergrenze großzügig: `Record` läuft höchstens 180 Sekunden, und selbst
  -- schnell gesprochen sind das keine 20.000 Zeichen. Die Grenze fängt nicht
  -- den redseligen Anrufer, sondern ein Modell, das statt einer Abschrift
  -- seitenweise Entschuldigungen zurückgibt.
  --
  -- Der leere String ist verboten, weil er wie eine Abschrift aussieht und
  -- keine ist: die Oberfläche zeigte dann eine Sprachnachricht ohne Inhalt an,
  -- statt den Link zur Aufnahme.
  add column voicemail_transcript text check (
    voicemail_transcript is null or length(trim(voicemail_transcript)) between 1 and 20000
  );
