const Sequelize = require('sequelize')
const dbConfig = require('../config/database')
import { logger } from '../utils/logger';
import { EmpresaInit } from '../models/Empresa';
import { UsuarioInit } from '../models/Usuario'
import { CidadeInit } from '../models/Cidade';
import { ClienteFornecedorInit } from '../models/ClienteFornecedor';
import { TipoIngressoInit } from '../models/TipoIngresso';
import { ProdutorInit } from '../models/Produtor';
import { EventoInit } from '../models/Evento';
import { EventoIngressoInit } from '../models/EventoIngresso';
import { IngressoInit } from '../models/Ingresso';
import { TransacaoInit } from '../models/Transacao';
import { UsuarioMetodoPagamentoInit } from '../models/ClienteMetodoPagamento';
import { CupomPromocionalInit } from '../models/CupomPromocional';
import { VisitasInit } from '../models/Visitas';
import { EventoSuiteInit } from '../models/EventoSuite';
import { EventoSuiteFotoInit } from '../models/EventoSuiteFoto';
import { ReservaHospedagemInit } from '../models/ReservaHospedagem';
import { ReservaSuiteInit } from '../models/ReservaSuite';
import { ReservaHospedeInit } from '../models/ReservaHospede';
import { PagamentoHospedagemInit } from '../models/PagamentoHospedagem';
import { HospedagemPagamentoOperacaoInit } from '../models/HospedagemPagamentoOperacao';
import { ReservaSuiteMovimentacaoInit } from '../models/ReservaSuiteMovimentacao';
import { ReservaPeriodoMovimentacaoInit } from '../models/ReservaPeriodoMovimentacao';
import { HospedinPlaceTypeInit } from '../models/HospedinPlaceType';
import { HospedinPlaceInit } from '../models/HospedinPlace';
import { HospedinReservationInit } from '../models/HospedinReservation';
import { HospedinSyncLogInit } from '../models/HospedinSyncLog';
import { IntegrationSyncStateInit } from '../models/IntegrationSyncState';
import { HospedinPlaceSuiteMapInit } from '../models/HospedinPlaceSuiteMap';
import { ReservaIdentificadorExternoInit } from '../models/ReservaIdentificadorExterno';
import { ReservaOrigemFinanceiraInit } from '../models/ReservaOrigemFinanceira';
import { ReservaOrigemPayloadInit } from '../models/ReservaOrigemPayload';
import { ReservaHospedeDocumentoInit } from '../models/ReservaHospedeDocumento';
import { IntegrationProviderConfigInit } from '../models/IntegrationProviderConfig';
import { IntegrationProviderStateInit } from '../models/IntegrationProviderState';
import { IntegrationSyncExecutionInit } from '../models/IntegrationSyncExecution';
import { IntegrationEntitySyncEventInit } from '../models/IntegrationEntitySyncEvent';
import { HospedagemRefreshStateInit } from '../models/HospedagemRefreshState';
const ConfigIniciais = require('./ConfigIniciais')
const FuncaoSistema = require('./FuncaoSistema')

const connection = new Sequelize(dbConfig);

(async () => {
  try {
    // Autenticação da conexão
    await connection.authenticate();
    logger.info('Conectado no banco de dados');
    // ContaAPagarInit(connection)
    // ContaAReceberInit(connection)
    // ContaBancariaInit(connection)
    // VeiculoInit(connection)

    // Inicializando modelos    
    EmpresaInit(connection)
    UsuarioInit(connection)
    CidadeInit(connection)

    ClienteFornecedorInit(connection)
    TipoIngressoInit(connection)
    ProdutorInit(connection)
    CupomPromocionalInit(connection);
    EventoInit(connection)
    EventoIngressoInit(connection)
    IngressoInit(connection)
    EventoSuiteInit(connection)
    EventoSuiteFotoInit(connection)
    TransacaoInit(connection)
    ReservaHospedagemInit(connection)
    ReservaSuiteInit(connection)
    ReservaHospedeInit(connection)
    ReservaIdentificadorExternoInit(connection)
    ReservaOrigemFinanceiraInit(connection)
    ReservaOrigemPayloadInit(connection)
    ReservaHospedeDocumentoInit(connection)
    IntegrationProviderConfigInit(connection)
    IntegrationProviderStateInit(connection)
    IntegrationSyncExecutionInit(connection)
    IntegrationEntitySyncEventInit(connection)
    PagamentoHospedagemInit(connection)
    HospedagemPagamentoOperacaoInit(connection)
    ReservaSuiteMovimentacaoInit(connection)
    ReservaPeriodoMovimentacaoInit(connection)
    HospedinPlaceTypeInit(connection)
    HospedinPlaceInit(connection)
    HospedinReservationInit(connection)
    HospedinSyncLogInit(connection)
    IntegrationSyncStateInit(connection)
    HospedinPlaceSuiteMapInit(connection)
    UsuarioMetodoPagamentoInit(connection)
    VisitasInit(connection)
    HospedagemRefreshStateInit(connection)

    // Sincronizando os modelos com o banco de dados        
    // await connection.sync();
    // await connection.sync({ alter: true });

    // Executando configurações iniciais
    // await FuncaoSistema.funcaoSistema();
    // await ConfigIniciais.configUsuario();


  } catch (error: any) {
    logger.error('Banco de dados não conectado', {
      message: error?.message,
      stack: error?.stack,
    });
  }
})();

export default connection;