BEGIN;
SELECT pg_advisory_xact_lock(865431207);

CREATE TABLE IF NOT EXISTS public.minicursos (
  id text PRIMARY KEY,
  nome text NOT NULL,
  data text NOT NULL,
  capacidade integer NOT NULL DEFAULT 25 CHECK (capacidade > 0),
  ordem integer NOT NULL
);

CREATE TABLE IF NOT EXISTS public.inscricoes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nome text NOT NULL CHECK (char_length(nome) BETWEEN 3 AND 120),
  telefone text NOT NULL CHECK (telefone ~ '^\+55[1-9][0-9]([2-5][0-9]{7}|9[0-9]{8})$'),
  curso text NOT NULL REFERENCES public.minicursos(id),
  criado_em timestamptz NOT NULL DEFAULT clock_timestamp(),
  CONSTRAINT inscricoes_curso_telefone_unique UNIQUE (curso, telefone)
);
CREATE INDEX IF NOT EXISTS inscricoes_curso_data_idx ON public.inscricoes(curso, criado_em);

CREATE TABLE IF NOT EXISTS public.administradores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  usuario text NOT NULL UNIQUE,
  senha_hash text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sessoes_admin (
  token_hash text PRIMARY KEY,
  administrador_id uuid NOT NULL REFERENCES public.administradores(id) ON DELETE CASCADE,
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessoes_admin_expira_idx ON public.sessoes_admin(expira_em);

INSERT INTO public.minicursos (id, nome, data, capacidade, ordem) VALUES
  ('sites-ia', 'Desenvolvimento de sites com IA', '29/09', 25, 1),
  ('impressao-3d', 'Modelagem e impressão 3D', '29/10', 25, 2),
  ('corte-laser', 'Corte a laser', '24/11', 25, 3),
  ('ecommerce', 'E-commerce', '10 a 13/12', 25, 4)
ON CONFLICT (id) DO NOTHING;

-- A capacidade da turma é informativa; inscrições continuam abertas após 25 cadastros.
CREATE OR REPLACE FUNCTION public.registrar_inscricao(p_nome text, p_telefone text, p_curso text)
RETURNS SETOF public.inscricoes
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = pg_catalog
AS $$
BEGIN
  PERFORM 1 FROM public.minicursos c WHERE c.id = p_curso;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Minicurso não encontrado' USING ERRCODE = 'P0002';
  END IF;
  IF EXISTS (SELECT 1 FROM public.inscricoes i WHERE i.curso = p_curso AND i.telefone = p_telefone) THEN
    RAISE EXCEPTION 'Inscrição duplicada' USING ERRCODE = '23505';
  END IF;
  RETURN QUERY INSERT INTO public.inscricoes (nome, telefone, curso)
    VALUES (p_nome, p_telefone, p_curso) RETURNING *;
END;
$$;
REVOKE ALL ON FUNCTION public.registrar_inscricao(text, text, text) FROM PUBLIC;

-- Somente o servidor com DATABASE_URL consulta dados. Nenhuma política pública.
ALTER TABLE public.minicursos ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.inscricoes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.administradores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sessoes_admin ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.minicursos, public.inscricoes, public.administradores, public.sessoes_admin FROM PUBLIC;
DO $$
DECLARE role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON FUNCTION public.registrar_inscricao(text, text, text) FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON public.minicursos, public.inscricoes, public.administradores, public.sessoes_admin FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
COMMIT;
