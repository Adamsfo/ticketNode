-- Separa observação importada (Hospedin) da anotação operacional do Jango.
-- observacoes permanece como espelho do texto exibido (importada + operador).

ALTER TABLE ReservaHospedagem
  ADD COLUMN observacaoImportada TEXT NULL AFTER observacoes,
  ADD COLUMN observacaoOperador TEXT NULL AFTER observacaoImportada;

-- Dados existentes: Hospedin → importada; demais origens → operador.
UPDATE ReservaHospedagem
SET observacaoImportada = observacoes
WHERE origemReserva = 'HOSPEDIN'
  AND observacoes IS NOT NULL
  AND TRIM(observacoes) <> '';

UPDATE ReservaHospedagem
SET observacaoOperador = observacoes
WHERE (origemReserva IS NULL OR origemReserva <> 'HOSPEDIN')
  AND observacoes IS NOT NULL
  AND TRIM(observacoes) <> '';
