-- Executable form of the outbound guarantees.
--
--   psql "$DB_URL" -f supabase/tests/campaigns.test.sql
--
-- Every check raises on failure; the whole thing rolls back.
--
-- Ein ausgehender Anruf ist die einzige Stelle, an der Norra von sich aus
-- fremde Telefone klingeln lässt. Drei Sorten Zusage stehen deshalb hier:
--
--   1. **Zeit.** Ein Werbeanruf um 22 Uhr ist in Deutschland eine
--      Ordnungswidrigkeit. Das Anrufzeitfenster ist geprüftes Feld, nicht
--      Freitext, den ein Workflow hoffentlich liest.
--   2. **Rolle.** Wählen kostet Geld und trifft Fremde. Ein Support-Konto darf
--      Kampagnen sehen, aber keine anlegen.
--   3. **Mandant.** Eine Zielliste ist eine Liste echter Rufnummern. Sie
--      verlässt ihre Organisation nicht.

begin;

do $$
declare
  v_admin uuid := 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
  v_member uuid := 'cccccccc-cccc-cccc-cccc-cccccccccccc';
  v_rival uuid := 'dddddddd-dddd-dddd-dddd-dddddddddddd';
  v_org uuid;
  v_rival_org uuid;
  v_agent uuid;
  v_number uuid;
  v_campaign uuid;
  v_target uuid;
  v_count integer;
begin
  insert into auth.users (id, email, raw_user_meta_data)
  values (v_admin, 'admin@camp.test', '{"organization_name":"Campaign Test"}');
  select organization_id into v_org from public.users where id = v_admin;

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_member, 'member@camp.test', jsonb_build_object('organization_id', v_org::text));

  insert into auth.users (id, email, raw_user_meta_data)
  values (v_rival, 'admin@camp-rival.test', '{"organization_name":"Campaign Rival"}');
  select organization_id into v_rival_org from public.users where id = v_rival;

  insert into public.agents (organization_id, name, slug, status, channels)
  values (v_org, 'Rückruf-Bot', 'rueckruf-bot', 'live', array['voice']) returning id into v_agent;

  insert into public.phone_numbers (organization_id, e164, agent_id, status)
  values (v_org, '+4930777666555', v_agent, 'active') returning id into v_number;

  -- ---- Zeitfenster ---------------------------------------------------------

  -- Ein Tag, den es nicht gibt.
  begin
    insert into public.call_campaigns (organization_id, name, goal, calling_window)
    values (v_org, 'Falscher Tag', 'Rückrufe', '{"montag":["09:00","17:00"]}');
    raise exception 'ein unbekannter Wochentag im Anrufzeitfenster wurde angenommen';
  exception when check_violation then null;
  end;

  -- Eine Uhrzeit, die es nicht gibt.
  begin
    insert into public.call_campaigns (organization_id, name, goal, calling_window)
    values (v_org, 'Falsche Zeit', 'Rückrufe', '{"mon":["9 Uhr","17:00"]}');
    raise exception 'eine unformatierte Uhrzeit wurde angenommen';
  exception when check_violation then null;
  end;

  -- Ein Fenster, das rückwärts läuft, erreicht nie jemanden -- und das fiele
  -- erst nach Tagen auf, weil die Kampagne dabei „läuft".
  begin
    insert into public.call_campaigns (organization_id, name, goal, calling_window)
    values (v_org, 'Rückwärts', 'Rückrufe', '{"mon":["17:00","09:00"]}');
    raise exception 'ein rückwärts laufendes Anrufzeitfenster wurde angenommen';
  exception when check_violation then null;
  end;

  -- 22 Uhr ist eine gültige *Form*. Dass es rechtlich keine gute Idee ist,
  -- entscheidet die Datenbank nicht -- sie stellt nur sicher, dass die Zeit
  -- eine Zeit ist und der Workflow sich darauf verlassen kann.
  insert into public.call_campaigns (organization_id, name, goal, calling_window, created_by)
  values (v_org, 'Rückrufe KW38', 'Offene Rückrufwünsche abarbeiten und einen Termin anbieten.',
          '{"mon":["09:00","17:00"],"tue":["09:00","17:00"],"wed":["09:00","12:00"]}', v_admin)
  returning id into v_campaign;

  -- ---- Halb konfiguriert läuft nicht ---------------------------------------

  -- Eine laufende Kampagne ohne Agent sähe aktiv aus und wählte nie. Das ist
  -- die teuerste Sorte Fehler: sie meldet sich nicht.
  begin
    update public.call_campaigns set status = 'running' where id = v_campaign;
    raise exception 'eine Kampagne ohne Agent und Nummer ging auf running';
  exception when check_violation then null;
  end;

  update public.call_campaigns
  set agent_id = v_agent, phone_number_id = v_number, status = 'running', started_at = now()
  where id = v_campaign;

  -- ---- Ziele ---------------------------------------------------------------

  begin
    insert into public.campaign_targets (organization_id, campaign_id, e164)
    values (v_org, v_campaign, '030 7776665');
    raise exception 'eine Nummer ohne E.164-Form wurde angenommen';
  exception when check_violation then null;
  end;

  insert into public.campaign_targets (organization_id, campaign_id, e164, display_name, context)
  values (v_org, v_campaign, '+4915112345678', 'A. Beispiel', '{"vorgang":"BX-4471"}')
  returning id into v_target;

  -- Dieselbe Nummer zweimal wäre ein Doppelanruf, und den merkt sich der
  -- Angerufene.
  begin
    insert into public.campaign_targets (organization_id, campaign_id, e164)
    values (v_org, v_campaign, '+4915112345678');
    raise exception 'dieselbe Nummer wurde zweimal in dieselbe Kampagne gelassen';
  exception when unique_violation then null;
  end;

  -- Ein frisches Ziel ist sofort fällig und noch nie versucht.
  select count(*) into v_count
  from public.campaign_targets
  where id = v_target and outcome = 'pending' and attempts = 0 and next_attempt_at is not null;
  if v_count <> 1 then
    raise exception 'ein frisches Ziel startet nicht als sofort fällig';
  end if;

  -- ---- Anrufbeantworter-Erkennung ------------------------------------------

  begin
    insert into public.calls (organization_id, provider_call_id, direction, answered_by)
    values (v_org, 'CA-out-bad', 'outbound', 'mailbox');
    raise exception 'ein erfundenes AMD-Ergebnis wurde angenommen';
  exception when check_violation then null;
  end;

  insert into public.calls (organization_id, phone_number_id, agent_id, provider_call_id,
                            direction, to_e164, campaign_target_id, answered_by)
  values (v_org, v_number, v_agent, 'CA-out-1', 'outbound', '+4915112345678', v_target, 'machine');

  update public.campaign_targets
  set attempts = 1, last_attempt_at = now(), outcome = 'voicemail',
      next_attempt_at = now() + interval '4 hours'
  where id = v_target;

  -- ---- Rolle ---------------------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_member::text, true);
  set local role authenticated;

  -- Sehen darf ein Mitglied: eine Kampagne ist Arbeitsstand.
  select count(*) into v_count from public.call_campaigns;
  if v_count <> 1 then
    raise exception 'ein Mitglied sieht % Kampagnen, erwartet 1', v_count;
  end if;

  -- Anlegen nicht: Wählen kostet Geld und trifft Fremde.
  begin
    insert into public.call_campaigns (organization_id, name, goal)
    values (v_org, 'Von einem Mitglied', 'Irgendwas');
    raise exception 'ein Mitglied ohne Admin-Rolle hat eine Kampagne angelegt';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.campaign_targets (organization_id, campaign_id, e164)
    values (v_org, v_campaign, '+4915199998888');
    raise exception 'ein Mitglied ohne Admin-Rolle hat ein Anrufziel angelegt';
  exception when insufficient_privilege then null;
  end;

  reset role;

  -- ---- Mandant -------------------------------------------------------------

  perform set_config('request.jwt.claim.sub', v_rival::text, true);
  set local role authenticated;

  select count(*) into v_count from public.call_campaigns;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % Kampagnen, erwartet 0', v_count;
  end if;

  -- Die eigentliche Zusage: eine Zielliste ist eine Liste echter Rufnummern.
  select count(*) into v_count from public.campaign_targets;
  if v_count <> 0 then
    raise exception 'ein fremder Admin sieht % Anrufziele, erwartet 0', v_count;
  end if;

  reset role;

  raise notice 'campaigns: all checks passed';
end $$;

rollback;
