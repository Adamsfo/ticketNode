"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require('dotenv').config();
const express_1 = __importDefault(require("express"));
const http_1 = __importDefault(require("http")); // Importa o http para criar um servidor HTTP
const logger_1 = require("./utils/logger");
const authRoutes = require('./routes/authRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const cidadeRoutes = require('./routes/cidadeRoutes');
const ClienteFornecedorRoutes = require('./routes/clienteFornecedorRoutes');
const empresaRoutes = require('./routes/empresaRoutes');
const enderecoRoutes = require('./routes/enderecoRoutes');
const tipoIngressoRoutes = require('./routes/tipoIngressoRoutes');
const produtorRoutes = require('./routes/produtorRoutes');
const eventoRoutes = require('./routes/eventoRoutes');
const eventoIngressoRoutes = require('./routes/eventoIngressoRoutes');
const pagamentoRoutes = require('./routes/pagamentoRoutes');
const ingresssoRoutes = require('./routes/ingressoRoutes');
const suiteRoutes = require('./routes/eventoSuiteRoutes');
const reservaSuiteRoutes = require('./routes/reservaSuiteRoutes');
const hospedagemAdminRoutes = require('./routes/hospedagemAdminRoutes');
const limpezaSuitesRoutes = require('./routes/limpezaSuitesRoutes');
const hospedagemReceberSaldoRoutes = require('./routes/hospedagemReceberSaldoRoutes');
const hospedagemPagamentoRoutes = require('./routes/hospedagemPagamentoRoutes');
const transacaoRoutes = require('./routes/transacaoRoutes');
const cupomPromocionalRoutes = require('./routes/cupomPromocialRoutes');
const jangoRoutes = require('./routes/jangoRoutes');
const hospedinIntegrationRoutes = require('./routes/hospedinIntegrationRoutes');
const integrationAdminRoutes = require('./routes/integrationAdminRoutes');
const reservaHospedagemJobs_1 = require("./jobs/reservaHospedagemJobs");
const integrationSyncJobs_1 = require("./jobs/integrationSyncJobs");
const uploadStorage_1 = require("./utils/uploadStorage");
/**
 * Silencia console.log legado fora de DEBUG.
 * Preferir `logger.*` em código novo.
 */
if (!(0, logger_1.isLogEnabled)('DEBUG')) {
    // eslint-disable-next-line no-console
    console.log = (...args) => {
        logger_1.logger.debug(args.map(String).join(' '));
    };
    // eslint-disable-next-line no-console
    console.debug = (...args) => {
        logger_1.logger.debug(args.map(String).join(' '));
    };
    // eslint-disable-next-line no-console
    console.info = (...args) => {
        logger_1.logger.debug(args.map(String).join(' '));
    };
    // eslint-disable-next-line no-console
    console.table = () => undefined;
    // eslint-disable-next-line no-console
    console.dir = () => undefined;
}
// Inicializa o banco de dados
require('./database/index');
const cors = require('cors');
const fileupload = require('express-fileupload');
var path = require('path');
var publicDir = path.join(__dirname, 'public');
var uploadsDir = uploadStorage_1.uploadStorage.getUploadsDir();
const errorHandler = require('./middlewares/errorHandler');
const server = (0, express_1.default)();
// Middleware
server.use(cors());
server.use(express_1.default.json({ limit: '4mb' }));
server.use(express_1.default.urlencoded({ extended: true, limit: '4mb' }));
server.use(fileupload());
// Servindo arquivos estáticos
server.use('/', express_1.default.static(publicDir));
server.use('/uploads', express_1.default.static(uploadsDir));
// Rotas
server.use(authRoutes);
server.use(usuarioRoutes);
server.use(cidadeRoutes);
server.use(ClienteFornecedorRoutes);
server.use(empresaRoutes);
server.use(enderecoRoutes);
server.use(tipoIngressoRoutes);
server.use(produtorRoutes);
server.use(eventoRoutes);
server.use(eventoIngressoRoutes);
server.use(pagamentoRoutes);
server.use(ingresssoRoutes);
server.use(transacaoRoutes);
server.use(cupomPromocionalRoutes);
server.use(jangoRoutes);
server.use(suiteRoutes);
server.use(reservaSuiteRoutes);
server.use(hospedagemAdminRoutes);
server.use(limpezaSuitesRoutes);
server.use(hospedagemReceberSaldoRoutes);
server.use(hospedagemPagamentoRoutes);
server.use(hospedinIntegrationRoutes);
server.use(integrationAdminRoutes);
// Tratamento de erros
server.use(errorHandler);
// Rota padrão
server.get('/', (req, res) => {
    res.send('Hello World');
});
// Rota de upload (único endpoint — lógica em uploadStorage)
server.post('/upload', async (req, res) => {
    try {
        const result = await uploadStorage_1.uploadStorage.saveFromBase64({
            file: req.body?.file,
            prefixo: req.body?.prefixo,
            Codigo: req.body?.Codigo,
            mimeType: req.body?.mimeType,
            nomeOriginal: req.body?.nomeOriginal,
        });
        return res.send({
            filename: result.filename,
            publicPath: result.publicPath,
        });
    }
    catch (err) {
        const message = err?.message || 'Não foi possível salvar o arquivo.';
        const status = /nenhum arquivo|vazio|inválido|muito grande|formato|não suportado/i.test(message)
            ? 400
            : 500;
        if (status === 500)
            logger_1.logger.error('upload falhou', err);
        return res.status(status).json({
            status: status === 400 ? 'fail' : 'error',
            message,
        });
    }
});
// Inicia o WebSocket
const httpServer = http_1.default.createServer(server);
// Define a porta a partir do arquivo de configuração e inicia o servidor
const PORT = process.env.PORT || 9000; // Define a porta padrão como 9000 se não estiver no .env
httpServer.listen(PORT, () => {
    logger_1.logger.info(`API iniciada em ${process.env.BASE || `http://localhost:${PORT}`} (porta ${PORT})`);
    (0, reservaHospedagemJobs_1.iniciarJobsReservaHospedagem)();
    void (0, integrationSyncJobs_1.iniciarJobsIntegracaoSync)();
});
