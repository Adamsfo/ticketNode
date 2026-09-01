-- Indicador operacional: possível pagamento via OTA (análise do note na importação).
-- Não automatiza quitação nem lança pagamento.

ALTER TABLE ReservaHospedagem
  ADD COLUMN possivel_pagamento_ota TINYINT(1) NOT NULL DEFAULT 0 AFTER canal_venda,
  ADD COLUMN possivel_pagamento_ota_trecho TEXT NULL AFTER possivel_pagamento_ota;

CREATE INDEX idx_reserva_hosp_possivel_pagamento_ota
  ON ReservaHospedagem (possivel_pagamento_ota);
