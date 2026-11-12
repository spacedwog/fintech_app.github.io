-- Captured contact requests. Access and retention must follow the privacy policy.
create table leads (
    id varchar(36) primary key,
    name varchar(100) not null,
    email varchar(254) not null,
    phone varchar(30),
    message text,
    consent boolean not null,
    consented_at timestamp not null,
    created_at timestamp not null
);

create index idx_leads_created_at on leads (created_at);
