require('dotenv').config();
import express, { Request, Response } from 'express';
import http from 'http'; // Importa o http para criar um servidor HTTP
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
const hospedagemReceberSaldoRoutes = require('./routes/hospedagemReceberSaldoRoutes');
const hospedagemPagamentoRoutes = require('./routes/hospedagemPagamentoRoutes');
const transacaoRoutes = require('./routes/transacaoRoutes');
const cupomPromocionalRoutes = require('./routes/cupomPromocialRoutes');
const jangoRoutes = require('./routes/jangoRoutes');
const hospedinIntegrationRoutes = require('./routes/hospedinIntegrationRoutes');
import { iniciarJobsReservaHospedagem } from './jobs/reservaHospedagemJobs';
import { uploadStorage } from './utils/uploadStorage';

// Inicializa o banco de dados
require('./database/index');
const cors = require('cors');
const fileupload = require('express-fileupload');
var path = require('path');
var publicDir = path.join(__dirname, 'public');
var uploadsDir = uploadStorage.getUploadsDir();
const errorHandler = require('./middlewares/errorHandler');

const server = express();

// Middleware
server.use(cors());
server.use(express.json({ limit: '4mb' }));
server.use(express.urlencoded({ extended: true, limit: '4mb' }));
server.use(fileupload());


// Servindo arquivos estáticos
server.use('/', express.static(publicDir));
server.use('/uploads', express.static(uploadsDir));

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
server.use(ingresssoRoutes)
server.use(transacaoRoutes)
server.use(cupomPromocionalRoutes)
server.use(jangoRoutes)
server.use(suiteRoutes)
server.use(reservaSuiteRoutes)
server.use(hospedagemAdminRoutes)
server.use(hospedagemReceberSaldoRoutes)
server.use(hospedagemPagamentoRoutes)
server.use(hospedinIntegrationRoutes)

// Tratamento de erros
server.use(errorHandler);

// Rota padrão
server.get('/', (req: any, res: any) => {
    res.send('Hello World');
});

// Rota de upload (único endpoint — lógica em uploadStorage)
server.post('/upload', async (req: Request, res: Response) => {
    try {
        const result = await uploadStorage.saveFromBase64({
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
    } catch (err: any) {
        const message = err?.message || 'Não foi possível salvar o arquivo.';
        const status =
            /nenhum arquivo|vazio|inválido|muito grande|formato|não suportado/i.test(
                message
            )
                ? 400
                : 500;
        if (status === 500) console.error('[upload]', err);
        return res.status(status).json({
            status: status === 400 ? 'fail' : 'error',
            message,
        });
    }
});

// Inicia o WebSocket
const httpServer = http.createServer(server);

// Define a porta a partir do arquivo de configuração e inicia o servidor
const PORT = process.env.PORT || 9000; // Define a porta padrão como 9000 se não estiver no .env
httpServer.listen(PORT, () => {
    console.log(`Servidor rodando no endereço: ${process.env.BASE || `http://localhost:${PORT}`} e porta ${PORT}`);
    iniciarJobsReservaHospedagem();
});
