-- Quotes and the futures price, kept so the LTP agent can fill at the bid or ask. Nullable: snapshots recorded before this migration have none.
ALTER TABLE ltp_snapshots ADD COLUMN bid REAL;
ALTER TABLE ltp_snapshots ADD COLUMN ask REAL;
ALTER TABLE ltp_snapshots ADD COLUMN futures REAL;
