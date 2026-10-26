import { type MigrateUpArgs, sql } from '@payloadcms/db-postgres';
export async function up({ db }: MigrateUpArgs): Promise<void> {
  await db.execute(sql`
    GRANT SELECT ON public.articles,public.glossary_terms,public.editorial_reviews TO tt_cms_runtime;
    GRANT SELECT,INSERT,UPDATE ON public.publication_work TO tt_cms_runtime;
    CREATE FUNCTION public.guard_document_identity() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
    BEGIN IF OLD.id IS DISTINCT FROM NEW.id THEN RAISE EXCEPTION 'Document identity is fixed' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
    CREATE TRIGGER articles_identity BEFORE UPDATE OF id ON public.articles FOR EACH ROW EXECUTE FUNCTION public.guard_document_identity();
    CREATE TRIGGER glossary_terms_identity BEFORE UPDATE OF id ON public.glossary_terms FOR EACH ROW EXECUTE FUNCTION public.guard_document_identity();
    GRANT UPDATE(id) ON public.articles,public.glossary_terms TO tt_cms_runtime;
  `);
}
export async function down(): Promise<void> {
  throw Error('Destructive CMS rollback requires a reviewed restore or forward migration');
}
