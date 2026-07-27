-- Origem modular da Transacao (ingressos vs hospedagem).
-- Padrão INGRESSOS: linhas existentes e novas do módulo de ingressos
-- continuam sem alteração de comportamento.
-- Executar no banco antes de subir o backend com o campo no model.

ALTER TABLE Transacao
  ADD COLUMN origem_transacao ENUM('INGRESSOS', 'HOSPEDAGEM')
    NOT NULL DEFAULT 'INGRESSOS'
  AFTER tipoPagamento;
