-- Executable form of the profile/order-source guarantees.
--
--   psql "$DB_URL" -f supabase/tests/profile-orders.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Vier Zusagen:
--
--   1. **Eine Quelle ohne Ziel gibt es nicht.** Ein Google Sheet braucht Blatt
--      und Bereich, ein Endpunkt eine URL. Sonst scheitert das Tool erst im
--      Gespräch, und der Anrufer hört das Scheitern.
--   2. **Nur https.** Eine Bestellnummer ist ein Kundendatum; sie über http zu
--      schicken wäre dasselbe wie sie auf eine Postkarte zu schreiben.
--   3. **Es wird aufgezählt, was hinaus darf.** Eine leere Spaltenliste hieße
--      „nichts" oder „alles", je nach Lesart des Workflows — beides ist falsch.
--   4. **Mandant.** Die Bestelltabelle eines Kunden geht keinen anderen an.

begin;

do $$
declare
  v_admin uuid := '11112222-3333-4444-8555-666677778888';
  v_member uuid := '22223333-4444-5555-8666-777788889999';
  v_rival uuid := '33334444-5555-6666-8777-888899990000';
  v_org uuid;
  v_rival_org uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@profil.test', '{"organization_name":"Profil Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member, 'member@profil.test', jsonb_build_object('organization_id', v_org::text));

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_rival, 'admin@profil-rival.test', '{"organization_name":"Profil Rival"}');
  select organization_id into v_rival_org from public.users where id = v_rival;

  -- ---- Profil ---------------------------------------------------------------

  update public.organizations
  set display_name = 'Bäckerei Müller',
      industry = 'Bäckerei',
      about = 'Handwerksbäckerei mit drei Filialen in Leipzig, seit 1954.',
      hours_note = 'Mo–Fr 6–18 Uhr, Sa 6–12 Uhr, So geschlossen.'
  where id = v_org;

  -- Ein leerer Anzeigename ist kein Name. Er stünde im Prompt als Leerstelle,
  -- und der Agent sagte „Sie sprechen mit ." — schlimmer als gar kein Profil.
  begin
    update public.organizations set display_name = '   ' where id = v_org;
    raise exception 'ein leerer Anzeigename wurde angenommen';
  exception when check_violation then null;
  end;

  -- ---- Quelle ohne Ziel -----------------------------------------------------

  begin
    insert into public.order_sources (organization_id, label, kind, match_column, return_columns)
    values (v_org, 'Sheet ohne Blatt', 'google_sheet', 'Bestellnummer', array['Status']);
    raise exception 'ein Sheet ohne Blatt-ID wurde angelegt';
  exception when check_violation then null;
  end;

  begin
    insert into public.order_sources (organization_id, label, kind, sheet_id, match_column, return_columns)
    values (v_org, 'Sheet ohne Bereich', 'google_sheet', '1AbC', 'Bestellnummer', array['Status']);
    raise exception 'ein Sheet ohne Bereich wurde angelegt';
  exception when check_violation then null;
  end;

  begin
    insert into public.order_sources (organization_id, label, kind, match_column, return_columns)
    values (v_org, 'Endpunkt ohne URL', 'http', 'Bestellnummer', array['Status']);
    raise exception 'ein http-Quelle ohne URL wurde angelegt';
  exception when check_violation then null;
  end;

  -- ---- Nur https ------------------------------------------------------------

  begin
    insert into public.order_sources (organization_id, label, kind, endpoint_url, match_column, return_columns)
    values (v_org, 'Unverschluesselt', 'http', 'http://intern.example.com/orders',
            'Bestellnummer', array['Status']);
    raise exception 'ein http-Endpunkt ohne TLS wurde angenommen';
  exception when check_violation then null;
  end;

  -- ---- Was hinaus darf ------------------------------------------------------

  begin
    insert into public.order_sources (organization_id, label, kind, sheet_id, sheet_range,
                                      match_column, return_columns)
    values (v_org, 'Ohne Spaltenliste', 'google_sheet', '1AbC', 'Bestellungen!A:H',
            'Bestellnummer', array[]::text[]);
    raise exception 'eine Quelle ohne freigegebene Spalten wurde angelegt';
  exception when check_violation then null;
  end;

  -- Gegenprobe: vollständig ausgefüllt geht dieselbe Zeile durch. Ohne sie
  -- bewiesen die Prüfungen oben nur, dass irgendetwas ablehnt.
  insert into public.order_sources (organization_id, label, kind, sheet_id, sheet_range,
                                    match_column, return_columns, created_by)
  values (v_org, 'Bestellungen 2026', 'google_sheet', '1AbCdEf', 'Bestellungen!A:H',
          'Bestellnummer', array['Status', 'Voraussichtliche Lieferung'], v_admin);

  insert into public.order_sources (organization_id, label, kind, endpoint_url,
                                    match_column, return_columns, created_by)
  values (v_org, 'Warenwirtschaft', 'http', 'https://api.example.com/orders',
          'order_no', array['status', 'eta'], v_admin);

  -- ---- Wer eintragen darf ---------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;

  select count(*) into v_count from public.order_sources;
  if v_count <> 2 then
    raise exception 'ein Mitglied sieht % Quellen, erwartet 2', v_count;
  end if;

  begin
    insert into public.order_sources (organization_id, label, kind, endpoint_url,
                                      match_column, return_columns)
    values (v_org, 'Von einem Mitglied', 'http', 'https://api.example.com/x',
            'order_no', array['status']);
    raise exception 'ein Mitglied hat eine Bestellquelle angelegt';
  exception when insufficient_privilege then null;
  end;

  reset role;

  -- ---- Mandant --------------------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_rival::text, true);
  set local role authenticated;

  select count(*) into v_count from public.order_sources;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % fremde Bestellquellen, erwartet 0', v_count;
  end if;

  select count(*) into v_count from public.organizations where display_name = 'Bäckerei Müller';
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht das Profil einer fremden Organisation';
  end if;

  reset role;

  raise notice 'profile-orders: all checks passed';
end $$;

rollback;
