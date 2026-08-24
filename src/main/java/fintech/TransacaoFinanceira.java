package fintech;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class TransacaoFinanceira {

    private static final String STATUS_PENDENTE = "PENDENTE";
    private static final String STATUS_PROCESSADA = "PROCESSADA";
    private static final String STATUS_CANCELADA = "CANCELADA";
    private static final String TIPO_TRANSFERENCIA = "TRANSFERENCIA";

    private Integer idTransacao;
    private String tipoTransacao;
    private BigDecimal valor;
    private String dataHora;
    private String status;
    private ContaDigital contaOrigem;
    private ContaDigital contaDestino;

    public TransacaoFinanceira() {
        System.out.println("Objetivo: inicializar uma transação financeira sem dados de processamento.");
    }

    public TransacaoFinanceira(Integer idTransacao, String tipoTransacao, BigDecimal valor, String dataHora, String status) {
        System.out.println("Objetivo: inicializar uma transação financeira com seus dados principais.");
        this.idTransacao = idTransacao;
        this.tipoTransacao = tipoTransacao;
        this.valor = valor;
        this.dataHora = dataHora;
        this.status = status;
    }

    public String getStatus() {
        System.out.println("Objetivo: retornar o status atual da transação.");
        return status;
    }

    public Integer getIdTransacao() {
        System.out.println("Objetivo: retornar o identificador da transação.");
        return idTransacao;
    }

    public String getTipoTransacao() {
        System.out.println("Objetivo: retornar o tipo da transação.");
        return tipoTransacao;
    }

    public BigDecimal getValor() {
        System.out.println("Objetivo: retornar o valor associado à transação.");
        return valor;
    }

    public String getDataHora() {
        System.out.println("Objetivo: retornar a data e hora registradas da transação.");
        return dataHora;
    }

    public void processarTransacao(ContaDigital contaOrigem, ContaDigital contaDestino, BigDecimal valorTransferencia) {
        System.out.println("Objetivo: processar a transferência entre contas e atualizar os dados da transação.");
        if (contaOrigem == null || contaDestino == null || valorTransferencia == null || valorTransferencia.signum() <= 0) {
            throw new IllegalArgumentException("Dados inválidos para processar transação.");
        }
        if (STATUS_PROCESSADA.equals(this.status)) {
            throw new IllegalStateException("Transação já foi processada.");
        }
        contaOrigem.transferirPara(contaDestino, valorTransferencia);
        this.contaOrigem = contaOrigem;
        this.contaDestino = contaDestino;
        this.tipoTransacao = TIPO_TRANSFERENCIA;
        this.valor = valorTransferencia;
        this.status = STATUS_PROCESSADA;
        this.dataHora = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    }

    public void cancelarTransacao() {
        System.out.println("Objetivo: cancelar uma transação processada e estornar os valores transferidos.");
        if (!STATUS_PROCESSADA.equals(this.status)) {
            throw new IllegalStateException("Apenas transações processadas podem ser canceladas.");
        }
        if (TIPO_TRANSFERENCIA.equals(this.tipoTransacao) && contaOrigem != null && contaDestino != null && valor != null) {
            contaDestino.sacar(valor);
            contaOrigem.depositar(valor);
        }
        this.status = STATUS_CANCELADA;
    }

    public boolean estaPendente() {
        System.out.println("Objetivo: verificar se a transação ainda está pendente.");
        return STATUS_PENDENTE.equals(status);
    }

    public String gerarComprovante() {
        System.out.println("Objetivo: gerar um comprovante textual com os dados da transação.");
        return "Comprovante{id=" + idTransacao +
                ", tipo='" + tipoTransacao + '\'' +
                ", valor=" + valor +
                ", dataHora='" + dataHora + '\'' +
                ", status='" + status + '\'' +
                '}';
    }
}
