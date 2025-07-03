"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const Sequelize = require('sequelize');
const dbConfig = require('../config/database');
const Empresa_1 = require("../models/Empresa");
const Usuario_1 = require("../models/Usuario");
const Cidade_1 = require("../models/Cidade");
const ClienteFornecedor_1 = require("../models/ClienteFornecedor");
const TipoIngresso_1 = require("../models/TipoIngresso");
const Produtor_1 = require("../models/Produtor");
const Evento_1 = require("../models/Evento");
const EventoIngresso_1 = require("../models/EventoIngresso");
const Ingresso_1 = require("../models/Ingresso");
const Transacao_1 = require("../models/Transacao");
const ClienteMetodoPagamento_1 = require("../models/ClienteMetodoPagamento");
const CupomPromocional_1 = require("../models/CupomPromocional");
const Visitas_1 = require("../models/Visitas");
const ConfigIniciais = require('./ConfigIniciais');
const FuncaoSistema = require('./FuncaoSistema');
const connection = new Sequelize(dbConfig);
(async () => {
    try {
        // Autenticação da conexão
        await connection.authenticate();
        console.log('Conectado no banco de dados!');
        // ContaAPagarInit(connection)
        // ContaAReceberInit(connection)
        // ContaBancariaInit(connection)
        // VeiculoInit(connection)
        // Inicializando modelos    
        (0, Empresa_1.EmpresaInit)(connection);
        (0, Usuario_1.UsuarioInit)(connection);
        (0, Cidade_1.CidadeInit)(connection);
        (0, ClienteFornecedor_1.ClienteFornecedorInit)(connection);
        (0, TipoIngresso_1.TipoIngressoInit)(connection);
        (0, Produtor_1.ProdutorInit)(connection);
        (0, CupomPromocional_1.CupomPromocionalInit)(connection);
        (0, Evento_1.EventoInit)(connection);
        (0, EventoIngresso_1.EventoIngressoInit)(connection);
        (0, Ingresso_1.IngressoInit)(connection);
        (0, Transacao_1.TransacaoInit)(connection);
        (0, ClienteMetodoPagamento_1.UsuarioMetodoPagamentoInit)(connection);
        (0, Visitas_1.VisitasInit)(connection);
        // Sincronizando os modelos com o banco de dados        
        await connection.sync();
        // await connection.sync({ alter: true });
        // Executando configurações iniciais
        await FuncaoSistema.funcaoSistema();
        await ConfigIniciais.configUsuario();
    }
    catch (error) {
        console.error('Banco de dados não conectado:', error);
    }
})();
exports.default = connection;
