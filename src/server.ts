require('dotenv').config();
import express from 'express';
import { iniciarServidorWebSocket } from './controllers/TorneioWebSocket';
import http from 'http'; // Importa o http para criar um servidor HTTP
const authRoutes = require('./routes/authRoutes');
const usuarioRoutes = require('./routes/usuarioRoutes');
const cidadeRoutes = require('./routes/cidadeRoutes');
const ClienteFornecedorRoutes = require('./routes/clienteFornecedorRoutes');
const empresaRoutes = require('./routes/empresaRoutes');
const enderecoRoutes = require('./routes/enderecoRoutes');
const blindRoutes = require('./routes/blindRoutes');
const estruturaRoutes = require('./routes/estruturaRoutes');
const torneioRoutes = require('./routes/torneioRoutes');
const ticketRoutes = require('./routes/ticketRoutes');

// Inicializa o banco de dados
require('./database/index');
const cors = require('cors');
const fileupload = require('express-fileupload');
var path = require('path');
var publicDir = path.join(__dirname, 'public');
const errorHandler = require('./middlewares/errorHandler');

const server = express();

// Middleware
server.use(cors());
server.use(express.json());
server.use(express.urlencoded({ extended: true }));
server.use(fileupload());

// Servindo arquivos estáticos
server.use('/', express.static(publicDir));

// Rotas
server.use(authRoutes);
server.use(usuarioRoutes);
server.use(cidadeRoutes);
server.use(ClienteFornecedorRoutes);
server.use(empresaRoutes);
server.use(enderecoRoutes);

// Tratamento de erros
server.use(errorHandler);

// Rota padrão
server.get('/', (req: any, res: any) => {
    res.send('Hello World');
});

// Cria um servidor HTTP


// Inicia o WebSocket
const httpServer = http.createServer(server);
iniciarServidorWebSocket(httpServer)

// Define a porta a partir do arquivo de configuração e inicia o servidor
const PORT = process.env.PORT || 9000; // Define a porta padrão como 9000 se não estiver no .env
httpServer.listen(PORT, () => {
    console.log(`Servidor rodando no endereço: ${process.env.BASE || `http://localhost:${PORT}`} e porta ${PORT}`);
});
