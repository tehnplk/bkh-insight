-- หาหนี้ตาม VN/AN ตอนตัดหนี้ด้วย STM (ar-sync settle) ไม่ให้สแกนทั้ง ar_ledger
CREATE INDEX ar_ledger_set_vn_idx ON ar_ledger (vn) WHERE kind = 'set' AND vn IS NOT NULL;
CREATE INDEX ar_ledger_set_an_idx ON ar_ledger (an) WHERE kind = 'set' AND an IS NOT NULL;
