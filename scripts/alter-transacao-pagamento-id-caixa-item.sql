-- Vínculo TransacaoPagamento ↔ lançamento de caixa Jango (CAIXA_ITEM.ID_CAIXA_ITEM no Firebird).
-- Executar no MySQL antes de subir o backend com o campo no model.
-- Sem FK: CAIXA_ITEM reside no PDV Jango, não no MySQL.

ALTER TABLE TransacaoPagamento
  ADD COLUMN id_caixa_item INT NULL AFTER status_pagamento;
