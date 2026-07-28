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
const EventoSuite_1 = require("../models/EventoSuite");
const EventoSuiteFoto_1 = require("../models/EventoSuiteFoto");
const ReservaHospedagem_1 = require("../models/ReservaHospedagem");
const ReservaSuite_1 = require("../models/ReservaSuite");
const ReservaHospede_1 = require("../models/ReservaHospede");
const PagamentoHospedagem_1 = require("../models/PagamentoHospedagem");
const HospedagemPagamentoOperacao_1 = require("../models/HospedagemPagamentoOperacao");
const ReservaSuiteMovimentacao_1 = require("../models/ReservaSuiteMovimentacao");
const ReservaPeriodoMovimentacao_1 = require("../models/ReservaPeriodoMovimentacao");
const HospedinPlaceType_1 = require("../models/HospedinPlaceType");
const HospedinPlace_1 = require("../models/HospedinPlace");
const HospedinReservation_1 = require("../models/HospedinReservation");
const HospedinSyncLog_1 = require("../models/HospedinSyncLog");
const IntegrationSyncState_1 = require("../models/IntegrationSyncState");
const HospedinPlaceSuiteMap_1 = require("../models/HospedinPlaceSuiteMap");
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
        (0, EventoSuite_1.EventoSuiteInit)(connection);
        (0, EventoSuiteFoto_1.EventoSuiteFotoInit)(connection);
        (0, Transacao_1.TransacaoInit)(connection);
        (0, ReservaHospedagem_1.ReservaHospedagemInit)(connection);
        (0, ReservaSuite_1.ReservaSuiteInit)(connection);
        (0, ReservaHospede_1.ReservaHospedeInit)(connection);
        (0, PagamentoHospedagem_1.PagamentoHospedagemInit)(connection);
        (0, HospedagemPagamentoOperacao_1.HospedagemPagamentoOperacaoInit)(connection);
        (0, ReservaSuiteMovimentacao_1.ReservaSuiteMovimentacaoInit)(connection);
        (0, ReservaPeriodoMovimentacao_1.ReservaPeriodoMovimentacaoInit)(connection);
        (0, HospedinPlaceType_1.HospedinPlaceTypeInit)(connection);
        (0, HospedinPlace_1.HospedinPlaceInit)(connection);
        (0, HospedinReservation_1.HospedinReservationInit)(connection);
        (0, HospedinSyncLog_1.HospedinSyncLogInit)(connection);
        (0, IntegrationSyncState_1.IntegrationSyncStateInit)(connection);
        (0, HospedinPlaceSuiteMap_1.HospedinPlaceSuiteMapInit)(connection);
        (0, ClienteMetodoPagamento_1.UsuarioMetodoPagamentoInit)(connection);
        (0, Visitas_1.VisitasInit)(connection);
        // Sincronizando os modelos com o banco de dados        
        // await connection.sync();
        // await connection.sync({ alter: true });
        // Executando configurações iniciais
        // await FuncaoSistema.funcaoSistema();
        // await ConfigIniciais.configUsuario();
    }
    catch (error) {
        console.error('Banco de dados não conectado:', error);
    }
})();
exports.default = connection;
