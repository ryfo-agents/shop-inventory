-- Compatibility upgrade; never rewrite 001-003 on deployed databases.
-- Also repairs installations that incorrectly recorded 001 before ownership ALTERs.
ALTER TABLE sections ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE subsections ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE items ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;
ALTER TABLE marks ADD COLUMN IF NOT EXISTS workspace_id text REFERENCES workspaces(id) ON DELETE CASCADE;

-- Unowned legacy roots cannot safely be attributed to a real account. Preserve
-- them in an archived quarantine (no memberships), never delete or guess owner.
DO $$
BEGIN
 IF EXISTS (SELECT 1 FROM sections WHERE workspace_id IS NULL) THEN
  LOOP
   -- The unique index checks every generated candidate, including a concurrent
   -- collision. Retry with a fresh address; never reuse or modify a real user.
   INSERT INTO users(id,email,display_name,disabled_at)
    VALUES ('__legacy_quarantine_owner__','legacy-quarantine-'||gen_random_uuid()::text||'@invalid.local','Legacy quarantine',now())
    ON CONFLICT (email) DO NOTHING;
   EXIT WHEN FOUND;
  END LOOP;
 END IF;
END $$;
INSERT INTO workspaces(id,name,owner_id,archived_at)
 SELECT '__legacy_quarantine__','Unassigned legacy inventory','__legacy_quarantine_owner__',now()
 WHERE EXISTS (SELECT 1 FROM sections WHERE workspace_id IS NULL);
UPDATE sections SET workspace_id='__legacy_quarantine__' WHERE workspace_id IS NULL;
UPDATE subsections c SET workspace_id=p.workspace_id FROM sections p WHERE c.section_id=p.id AND c.workspace_id IS NULL;
UPDATE items c SET workspace_id=p.workspace_id FROM subsections p WHERE c.subsection_id=p.id AND c.workspace_id IS NULL;
UPDATE marks c SET workspace_id=p.workspace_id FROM items p WHERE c.item_id=p.id AND c.workspace_id IS NULL;

-- Existing inconsistent relationships fail validation, rolling back the entire
-- migration and its version. Resolve explicitly; never silently reparent data.
ALTER TABLE sections ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE subsections ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE items ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE marks ALTER COLUMN workspace_id SET NOT NULL;
ALTER TABLE sections ADD CONSTRAINT sections_tenant_id UNIQUE(workspace_id,id);
ALTER TABLE subsections ADD CONSTRAINT subsections_tenant_id UNIQUE(workspace_id,id);
ALTER TABLE items ADD CONSTRAINT items_tenant_id UNIQUE(workspace_id,id);
ALTER TABLE subsections ADD CONSTRAINT subsections_tenant_parent FOREIGN KEY(workspace_id,section_id) REFERENCES sections(workspace_id,id) ON DELETE CASCADE;
ALTER TABLE items ADD CONSTRAINT items_tenant_parent FOREIGN KEY(workspace_id,subsection_id) REFERENCES subsections(workspace_id,id) ON DELETE CASCADE;
ALTER TABLE marks ADD CONSTRAINT marks_tenant_parent FOREIGN KEY(workspace_id,item_id) REFERENCES items(workspace_id,id) ON DELETE CASCADE;
ALTER TABLE marks ADD CONSTRAINT marks_valid_status CHECK(status IS NULL OR status IN ('unknown','have','missing','upgrade','blocking','na'));
ALTER TABLE marks ADD CONSTRAINT marks_valid_q CHECK(q IS NULL OR q>=0);
ALTER TABLE marks ADD CONSTRAINT marks_valid_c CHECK(c IS NULL OR (c>=0 AND c<'Infinity'::numeric));
ALTER TABLE marks ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1 CHECK (version > 0 AND version <= 9007199254740991);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0 CHECK (revision >= 0 AND revision <= 9007199254740991);
ALTER TABLE workspaces ADD COLUMN IF NOT EXISTS bootstrapped_at timestamptz;

-- Shared policy for every inventory read/write, rechecked inside the same
-- transaction as effects. Workspace row locks serialize revisions/bootstrap;
-- shared membership/user locks prevent revocation racing an authorized write.
CREATE FUNCTION shop_assert_access(p_workspace text,p_actor text,p_write boolean DEFAULT false)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
 IF p_write THEN
  PERFORM 1 FROM workspaces WHERE id=p_workspace AND archived_at IS NULL FOR UPDATE;
 ELSE
  PERFORM 1 FROM workspaces WHERE id=p_workspace AND archived_at IS NULL FOR SHARE;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM memberships WHERE workspace_id=p_workspace AND user_id=p_actor AND revoked_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
 PERFORM 1 FROM users WHERE id=p_actor AND disabled_at IS NULL FOR SHARE;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
END $$;

CREATE FUNCTION shop_patch_marks(p_workspace text,p_actor text,p_marks jsonb)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE
 b jsonb; old_version bigint; saved marks; output jsonb='[]'::jsonb;
 new_revision bigint;
BEGIN
 PERFORM shop_assert_access(p_workspace,p_actor,true);
 IF jsonb_typeof(p_marks) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_marks'; END IF;
 IF jsonb_array_length(p_marks)<1 OR jsonb_array_length(p_marks)>100 THEN RAISE EXCEPTION 'invalid_marks'; END IF;
 IF (SELECT count(DISTINCT value->>'itemId') FROM jsonb_array_elements(p_marks))<>jsonb_array_length(p_marks) THEN RAISE EXCEPTION 'invalid_marks'; END IF;
 FOR b IN SELECT value FROM jsonb_array_elements(p_marks) LOOP
  IF jsonb_typeof(b)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(b) k WHERE k NOT IN ('itemId','version','status','q','sp','n','c')) THEN RAISE EXCEPTION 'invalid_mark'; END IF;
  IF jsonb_typeof(b->'itemId') IS DISTINCT FROM 'string' OR length(b->>'itemId') NOT BETWEEN 1 AND 300 THEN RAISE EXCEPTION 'invalid_item'; END IF;
  IF NOT b ? 'version' THEN RAISE EXCEPTION 'precondition_required'; END IF;
  IF jsonb_typeof(b->'version') IS DISTINCT FROM 'number' THEN RAISE EXCEPTION 'invalid_version'; END IF;
  IF (b->>'version')::numeric<0 OR (b->>'version')::numeric>9007199254740991 OR trunc((b->>'version')::numeric)<>(b->>'version')::numeric THEN RAISE EXCEPTION 'invalid_version'; END IF;
  IF NOT (b ?| ARRAY['status','q','sp','n','c']) THEN RAISE EXCEPTION 'invalid_mark'; END IF;
  IF b ? 'status' AND jsonb_typeof(b->'status')<>'null' AND (jsonb_typeof(b->'status')<>'string' OR b->>'status' NOT IN ('unknown','have','missing','upgrade','blocking','na')) THEN RAISE EXCEPTION 'invalid_status'; END IF;
  IF b ? 'q' AND jsonb_typeof(b->'q')<>'null' THEN
   IF jsonb_typeof(b->'q')<>'number' THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
   IF (b->>'q')::numeric<0 OR (b->>'q')::numeric>2147483647 OR trunc((b->>'q')::numeric)<>(b->>'q')::numeric THEN RAISE EXCEPTION 'invalid_quantity'; END IF;
  END IF;
  IF b ? 'c' AND jsonb_typeof(b->'c')<>'null' THEN
   IF jsonb_typeof(b->'c')<>'number' THEN RAISE EXCEPTION 'invalid_cost'; END IF;
   IF (b->>'c')::numeric<0 OR (b->>'c')::numeric>1000000000 THEN RAISE EXCEPTION 'invalid_cost'; END IF;
  END IF;
  IF b ? 'sp' AND jsonb_typeof(b->'sp')<>'null' AND (jsonb_typeof(b->'sp')<>'string' OR length(b->>'sp')>2000) THEN RAISE EXCEPTION 'invalid_spec'; END IF;
  IF b ? 'n' AND jsonb_typeof(b->'n')<>'null' AND (jsonb_typeof(b->'n')<>'string' OR length(b->>'n')>10000) THEN RAISE EXCEPTION 'invalid_note'; END IF;
  PERFORM 1 FROM items i JOIN subsections s ON s.id=i.subsection_id AND s.workspace_id=i.workspace_id
   JOIN sections t ON t.id=s.section_id AND t.workspace_id=s.workspace_id
   WHERE i.id=b->>'itemId' AND i.workspace_id=p_workspace AND NOT i.deleted AND NOT s.deleted AND NOT t.deleted FOR SHARE OF i,s,t;
  IF NOT FOUND THEN RAISE EXCEPTION 'item_not_found'; END IF;
  SELECT version INTO old_version FROM marks WHERE item_id=b->>'itemId' AND workspace_id=p_workspace FOR UPDATE;
  IF coalesce(old_version,0)<>(b->>'version')::bigint THEN RAISE EXCEPTION 'revision_conflict'; END IF;
  INSERT INTO marks(item_id,workspace_id,status,q,sp,n,c,version,updated_at)
   VALUES(b->>'itemId',p_workspace,b->>'status',(b->>'q')::int,b->>'sp',b->>'n',(b->>'c')::numeric,1,clock_timestamp())
   ON CONFLICT(item_id) DO UPDATE SET
    status=CASE WHEN b ? 'status' THEN excluded.status ELSE marks.status END,
    q=CASE WHEN b ? 'q' THEN excluded.q ELSE marks.q END,
    sp=CASE WHEN b ? 'sp' THEN excluded.sp ELSE marks.sp END,
    n=CASE WHEN b ? 'n' THEN excluded.n ELSE marks.n END,
    c=CASE WHEN b ? 'c' THEN excluded.c ELSE marks.c END,
    version=marks.version+1,updated_at=excluded.updated_at
   WHERE marks.workspace_id=p_workspace RETURNING * INTO saved;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
  output=output || jsonb_build_array(to_jsonb(saved)-'workspace_id');
 END LOOP;
 UPDATE workspaces SET revision=revision+1,updated_at=clock_timestamp() WHERE id=p_workspace RETURNING revision INTO new_revision;
 INSERT INTO audit_events(id,workspace_id,actor_id,entity_type,entity_id,action,metadata)
  VALUES(gen_random_uuid()::text,p_workspace,p_actor,'mark',CASE WHEN jsonb_array_length(p_marks)=1 THEN p_marks->0->>'itemId' END,'patch',
   jsonb_build_object('count',jsonb_array_length(p_marks),'revision',new_revision,'items',(SELECT jsonb_agg(jsonb_build_object('itemId',value->>'itemId','fields',(SELECT jsonb_agg(k) FROM jsonb_object_keys(value) k WHERE k NOT IN ('version','itemId')))) FROM jsonb_array_elements(p_marks))));
 RETURN jsonb_build_object('marks',output,'revision',new_revision);
END $$;


-- The seed is trusted server-side data, never accepted from request bodies.
CREATE FUNCTION shop_state(p_workspace text,p_actor text,p_seed jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE result jsonb;
BEGIN
 PERFORM shop_assert_access(p_workspace,p_actor,p_seed IS NOT NULL);
 IF p_seed IS NOT NULL AND (SELECT bootstrapped_at IS NULL FROM workspaces WHERE id=p_workspace) THEN
  INSERT INTO sections(id,workspace_id,num,title,sort_order)
   SELECT p_workspace||':'||s.id,p_workspace,s.num,s.title,s.sort_order
   FROM jsonb_to_recordset(p_seed->'sections') s(id text,num int,title text,sort_order int)
   ON CONFLICT(id) DO NOTHING;
  INSERT INTO subsections(id,workspace_id,section_id,num,title,sort_order)
   SELECT p_workspace||':'||s.id,p_workspace,p_workspace||':'||s.section_id,s.num,s.title,s.sort_order
   FROM jsonb_to_recordset(p_seed->'subsections') s(id text,section_id text,num text,title text,sort_order int)
   ON CONFLICT(id) DO NOTHING;
  INSERT INTO items(id,workspace_id,subsection_id,label,qty,target,spec,phase,tags,store,sort_order)
   SELECT p_workspace||':'||s.id,p_workspace,p_workspace||':'||s.subsection_id,s.label,coalesce(s.qty,false),s.target,coalesce(s.spec,false),s.phase,coalesce(s.tags,'{}'),coalesce(s.store,'General'),s.sort_order
   FROM jsonb_to_recordset(p_seed->'items') s(id text,subsection_id text,label text,qty boolean,target int,spec boolean,phase int,tags text[],store text,sort_order int)
   ON CONFLICT(id) DO NOTHING;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements(p_seed->'sections') s LEFT JOIN sections t ON t.id=p_workspace||':'||(s->>'id') AND t.workspace_id=p_workspace WHERE t.id IS NULL)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_seed->'subsections') s LEFT JOIN subsections t ON t.id=p_workspace||':'||(s->>'id') AND t.workspace_id=p_workspace WHERE t.id IS NULL)
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_seed->'items') s LEFT JOIN items t ON t.id=p_workspace||':'||(s->>'id') AND t.workspace_id=p_workspace WHERE t.id IS NULL) THEN
    RAISE EXCEPTION 'bootstrap_conflict';
  END IF;
  UPDATE workspaces SET bootstrapped_at=clock_timestamp(),revision=revision+1,updated_at=clock_timestamp() WHERE id=p_workspace;
  INSERT INTO audit_events(id,workspace_id,actor_id,entity_type,action,metadata)
   VALUES(gen_random_uuid()::text,p_workspace,p_actor,'workspace','bootstrap',jsonb_build_object('items',jsonb_array_length(p_seed->'items')));
 END IF;
 -- Workspace locks are held across these reads until the statement commits;
 -- supported inventory writers cannot interleave rows from different revisions.
 SELECT jsonb_build_object(
  'revision',w.revision,
  'sections',coalesce((SELECT jsonb_agg(to_jsonb(s)-'workspace_id' ORDER BY sort_order,id) FROM sections s WHERE s.workspace_id=p_workspace),'[]'),
  'subsections',coalesce((SELECT jsonb_agg(to_jsonb(s)-'workspace_id' ORDER BY sort_order,id) FROM subsections s WHERE s.workspace_id=p_workspace),'[]'),
  'items',coalesce((SELECT jsonb_agg(to_jsonb(i)-'workspace_id' ORDER BY sort_order,id) FROM items i WHERE i.workspace_id=p_workspace),'[]'),
  'marks',coalesce((SELECT jsonb_agg(to_jsonb(m)-'workspace_id' ORDER BY item_id) FROM marks m WHERE m.workspace_id=p_workspace),'[]'))
 INTO result FROM workspaces w WHERE w.id=p_workspace;
 RETURN result;
END $$;

CREATE FUNCTION shop_provision(p_actor text)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE actor users; workspace jsonb; new_id text;
BEGIN
 SELECT * INTO actor FROM users WHERE id=p_actor AND disabled_at IS NULL FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
 SELECT jsonb_build_object('id',w.id,'name',w.name,'role',m.role) INTO workspace
  FROM memberships m JOIN workspaces w ON w.id=m.workspace_id
  WHERE m.user_id=p_actor AND m.revoked_at IS NULL AND w.archived_at IS NULL
  ORDER BY w.created_at,w.id LIMIT 1;
 IF workspace IS NOT NULL THEN RETURN workspace; END IF;
 new_id=gen_random_uuid()::text;
 INSERT INTO workspaces(id,name,owner_id) VALUES(new_id,coalesce(nullif(actor.display_name,''),'My shop'),p_actor);
 INSERT INTO memberships(workspace_id,user_id,role) VALUES(new_id,p_actor,'owner');
 INSERT INTO audit_events(id,workspace_id,actor_id,entity_type,entity_id,action)
  VALUES(gen_random_uuid()::text,new_id,p_actor,'workspace',new_id,'provision');
 RETURN jsonb_build_object('id',new_id,'name',coalesce(nullif(actor.display_name,''),'My shop'),'role','owner');
END $$;

CREATE FUNCTION shop_login_session(p_actor text,p_session text,p_token_hash text,p_expires timestamptz)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE workspace jsonb;
BEGIN
 workspace=shop_provision(p_actor);
 INSERT INTO sessions(id,user_id,token_hash,expires_at) VALUES(p_session,p_actor,p_token_hash,p_expires);
 RETURN workspace;
END $$;

CREATE FUNCTION shop_register(p_actor text,p_email text,p_name text,p_password_hash text,p_session text,p_token_hash text,p_expires timestamptz)
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE workspace jsonb;
BEGIN
 INSERT INTO users(id,email,display_name,password_hash) VALUES(p_actor,p_email,p_name,p_password_hash);
 workspace=shop_login_session(p_actor,p_session,p_token_hash,p_expires);
 RETURN jsonb_build_object('user',jsonb_build_object('id',p_actor,'email',p_email,'display_name',p_name),'workspace',workspace);
END $$;
