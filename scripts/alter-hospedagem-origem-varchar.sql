-- Converte origemReserva de ENUM para VARCHAR(30) sem perda de dados.
-- Produção já possui valores: CLIENTE, ATENDENTE (e eventualmente SITE legado).
--
-- NÃO remove CLIENTE.
-- NÃO altera valores existentes.
-- Seguro para reexecução se a coluna já for VARCHAR.

-- 1) Amplia para VARCHAR preservando conteúdo atual do ENUM/VARCHAR
ALTER TABLE ReservaHospedagem
  MODIFY COLUMN origemReserva VARCHAR(30) NOT NULL DEFAULT 'CLIENTE';

-- 2) Garante default alinhado à produção (não reescreve linhas existentes)
ALTER TABLE ReservaHospedagem
  ALTER COLUMN origemReserva SET DEFAULT 'CLIENTE';
