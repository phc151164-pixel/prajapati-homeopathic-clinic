CREATE TABLE public.phc_reference_progress (
  doctor_id uuid NOT NULL REFERENCES public.phc_admin_accounts(user_id),
  book_id text NOT NULL CHECK (book_id ~ '^[a-z0-9-]{1,80}$'),
  bookmarked boolean NOT NULL,
  note text NOT NULL CHECK (char_length(note) <= 4000),
  last_opened timestamptz,
  PRIMARY KEY (doctor_id, book_id)
);

CREATE TABLE public.phc_consultation_documents (
  visit_id uuid PRIMARY KEY REFERENCES public.phc_visits(id),
  history text NOT NULL CHECK (char_length(history) <= 3000),
  observations text NOT NULL CHECK (char_length(observations) <= 3000),
  follow_up text NOT NULL CHECK (char_length(follow_up) <= 3000),
  consent_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NOT NULL REFERENCES public.phc_admin_accounts(user_id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  version integer NOT NULL CHECK (version > 0)
);

ALTER TABLE public.phc_reference_progress ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.phc_consultation_documents ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.phc_reference_progress, public.phc_consultation_documents
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT, INSERT, UPDATE ON public.phc_reference_progress TO service_role;
GRANT SELECT ON public.phc_consultation_documents TO service_role;

CREATE FUNCTION public.phc_save_consultation_document(
  p_actor uuid, p_visit uuid, p_version integer, p_history text,
  p_observations text, p_follow_up text, p_consent boolean, p_reviewed boolean
) RETURNS public.phc_consultation_documents
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE saved public.phc_consultation_documents;
BEGIN
  IF p_consent IS DISTINCT FROM true OR p_version IS NULL OR p_version < 0 THEN
    RAISE EXCEPTION 'Consent and version required' USING ERRCODE = '22023';
  END IF;
  PERFORM 1 FROM public.phc_admin_accounts WHERE user_id = p_actor AND active FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unauthorized' USING ERRCODE = '42501'; END IF;
  PERFORM 1 FROM public.phc_visits WHERE id = p_visit FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Unknown visit' USING ERRCODE = '22023'; END IF;
  IF p_version = 0 THEN
    INSERT INTO public.phc_consultation_documents
      (visit_id, history, observations, follow_up, updated_by, reviewed_at, version)
    VALUES
      (p_visit, p_history, p_observations, p_follow_up, p_actor,
       CASE WHEN p_reviewed THEN now() END, 1)
    ON CONFLICT (visit_id) DO NOTHING RETURNING * INTO saved;
  ELSE
    UPDATE public.phc_consultation_documents SET
      history = p_history, observations = p_observations, follow_up = p_follow_up,
      updated_by = p_actor, updated_at = now(), reviewed_at = CASE WHEN p_reviewed THEN now() END,
      version = version + 1
    WHERE visit_id = p_visit AND version = p_version RETURNING * INTO saved;
  END IF;
  IF saved.visit_id IS NULL THEN RAISE EXCEPTION 'Document changed' USING ERRCODE = '40001'; END IF;
  INSERT INTO public.phc_audit_log(actor, action, entity_id)
    VALUES (p_actor, 'consultation_document_saved', p_visit::text);
  RETURN saved;
END;
$$;
REVOKE ALL ON FUNCTION public.phc_save_consultation_document(uuid,uuid,integer,text,text,text,boolean,boolean)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.phc_save_consultation_document(uuid,uuid,integer,text,text,text,boolean,boolean)
  TO service_role;
