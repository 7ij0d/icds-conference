CREATE OR REPLACE FUNCTION pg_temp.get_or_create_sup(p_name text, p_now text) RETURNS int AS $$
DECLARE
  v_id int;
BEGIN
  IF p_name IS NULL OR trim(p_name) = '' THEN
    RETURN NULL;
  END IF;
  SELECT id INTO v_id FROM public.icds_supervisors WHERE trim(name) = trim(p_name) LIMIT 1;
  IF v_id IS NULL THEN
    INSERT INTO public.icds_supervisors (name, phone, access_pin, notes, is_active, created_at, updated_at)
    VALUES (trim(p_name), '', '', '', 1, p_now, p_now)
    RETURNING id INTO v_id;
  END IF;
  RETURN v_id;
END;
$$ LANGUAGE plpgsql;

DO $$
DECLARE
  v_now text := to_char(now() AT TIME ZONE 'Africa/Tripoli', 'YYYY-MM-DD HH24:MI:SS');
  v_day_sun int;
  v_day_mon int;
  v_day_tue int;
  v_day_wed int;
  v_day_thu int;
BEGIN
  SELECT id INTO v_day_sun FROM public.icds_registration_days WHERE day_key = 'sunday';
  SELECT id INTO v_day_mon FROM public.icds_registration_days WHERE day_key = 'monday';
  SELECT id INTO v_day_tue FROM public.icds_registration_days WHERE day_key = 'tuesday';
  SELECT id INTO v_day_wed FROM public.icds_registration_days WHERE day_key = 'wednesday';
  SELECT id INTO v_day_thu FROM public.icds_registration_days WHERE day_key = 'thursday';

  -- Sunday
  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_sun, 1, 1, pg_temp.get_or_create_sup('هنا أبو حسانة', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_sun, 1, 2, pg_temp.get_or_create_sup('أروى فوزي', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_sun, 2, 3, pg_temp.get_or_create_sup('آرام القرني', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_sun, 2, 4, pg_temp.get_or_create_sup('وديدة السكوني', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  -- Monday
  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_mon, 1, 1, pg_temp.get_or_create_sup('عبدالمؤمن بن عون', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_mon, 1, 2, pg_temp.get_or_create_sup('أحمد المشاي', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_mon, 2, 3, pg_temp.get_or_create_sup('منة إنيبة', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_mon, 2, 4, pg_temp.get_or_create_sup('وعد القماطي', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  -- Tuesday
  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_tue, 1, 1, pg_temp.get_or_create_sup('سلمى المراعيش', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_tue, 1, 2, pg_temp.get_or_create_sup('شهد التويبي', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_tue, 2, 3, pg_temp.get_or_create_sup('ملك إنيبة', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_tue, 2, 4, pg_temp.get_or_create_sup('يقين بالقاسم', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  -- Wednesday
  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_wed, 1, 1, pg_temp.get_or_create_sup('أميرة الرقيق', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_wed, 1, 2, pg_temp.get_or_create_sup('منال يونس', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_wed, 2, 3, NULL, v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_wed, 2, 4, pg_temp.get_or_create_sup('الشيماء خالد', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  -- Thursday
  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_thu, 1, 1, pg_temp.get_or_create_sup('سلبيل صقر', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_thu, 1, 2, pg_temp.get_or_create_sup('ميار الفريقة', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_thu, 2, 3, pg_temp.get_or_create_sup('منصور أحشاد', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

  INSERT INTO public.icds_day_supervisor_assignments (day_id, shift_number, slot_number, supervisor_id, updated_at)
  VALUES (v_day_thu, 2, 4, pg_temp.get_or_create_sup('معاذ المبروك', v_now), v_now)
  ON CONFLICT (day_id, slot_number) DO UPDATE SET shift_number = EXCLUDED.shift_number, supervisor_id = EXCLUDED.supervisor_id, updated_at = EXCLUDED.updated_at;

END $$;
