-- Fix function search path mutable security issue
-- Update existing functions to have fixed search_path

-- Update word_similarity functions
CREATE OR REPLACE FUNCTION public.word_similarity_dist_commutator_op(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$word_similarity_dist_commutator_op$function$;

CREATE OR REPLACE FUNCTION public.word_similarity_op(text, text)
RETURNS boolean
LANGUAGE c
STABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$word_similarity_op$function$;

CREATE OR REPLACE FUNCTION public.word_similarity_commutator_op(text, text)
RETURNS boolean
LANGUAGE c
STABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$word_similarity_commutator_op$function$;

CREATE OR REPLACE FUNCTION public.similarity_dist(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$similarity_dist$function$;

CREATE OR REPLACE FUNCTION public.word_similarity_dist_op(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$word_similarity_dist_op$function$;

-- Update trigram functions
CREATE OR REPLACE FUNCTION public.similarity(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$similarity$function$;

CREATE OR REPLACE FUNCTION public.similarity_op(text, text)
RETURNS boolean
LANGUAGE c
STABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$similarity_op$function$;

CREATE OR REPLACE FUNCTION public.word_similarity(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$word_similarity$function$;

CREATE OR REPLACE FUNCTION public.strict_word_similarity(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$strict_word_similarity$function$;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_op(text, text)
RETURNS boolean
LANGUAGE c
STABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$strict_word_similarity_op$function$;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_commutator_op(text, text)
RETURNS boolean
LANGUAGE c
STABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$strict_word_similarity_commutator_op$function$;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_op(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_op$function$;

CREATE OR REPLACE FUNCTION public.strict_word_similarity_dist_commutator_op(text, text)
RETURNS real
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$strict_word_similarity_dist_commutator_op$function$;

-- Update GIN/GiST functions
CREATE OR REPLACE FUNCTION public.gin_extract_value_trgm(text, internal)
RETURNS internal
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$gin_extract_value_trgm$function$;

CREATE OR REPLACE FUNCTION public.gin_extract_query_trgm(text, internal, smallint, internal, internal, internal, internal)
RETURNS internal
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$gin_extract_query_trgm$function$;

CREATE OR REPLACE FUNCTION public.gin_trgm_consistent(internal, smallint, text, integer, internal, internal, internal, internal)
RETURNS boolean
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$gin_trgm_consistent$function$;

CREATE OR REPLACE FUNCTION public.gin_trgm_triconsistent(internal, smallint, text, integer, internal, internal, internal)
RETURNS "char"
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$gin_trgm_triconsistent$function$;

-- Update utility functions
CREATE OR REPLACE FUNCTION public.set_limit(real)
RETURNS real
LANGUAGE c
STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$set_limit$function$;

CREATE OR REPLACE FUNCTION public.show_limit()
RETURNS real
LANGUAGE c
STABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$show_limit$function$;

CREATE OR REPLACE FUNCTION public.show_trgm(text)
RETURNS text[]
LANGUAGE c
IMMUTABLE PARALLEL SAFE STRICT
SET search_path = public
AS '$libdir/pg_trgm', $function$show_trgm$function$;