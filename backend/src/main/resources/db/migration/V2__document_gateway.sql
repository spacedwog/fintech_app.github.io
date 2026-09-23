create table if not exists app_document (
    collection_name varchar(120) not null,
    document_id varchar(120) not null,
    payload_json clob not null,
    created_at timestamp not null default current_timestamp,
    updated_at timestamp not null default current_timestamp,
    primary key (collection_name, document_id)
);

create index if not exists idx_app_document_collection
    on app_document (collection_name);
