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
    }

    public TransacaoFinanceira(Integer idTransacao, String tipoTransacao, BigDecimal valor, String dataHora, String status) {
        this.idTransacao = idTransacao;
        this.tipoTransacao = tipoTransacao;
        this.valor = valor;
        this.dataHora = dataHora;
        this.status = status;
    }

    public String getStatus() {
        return status;
    }

    public Integer getIdTransacao() {
        return idTransacao;
    }

    public String getTipoTransacao() {
        return tipoTransacao;
    }

    public BigDecimal getValor() {
        return valor;
    }

    public String getDataHora() {
        return dataHora;
    }

    public void processarTransacao(ContaDigital contaOrigem, ContaDigital contaDestino, BigDecimal valorTransferencia) {
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
        return STATUS_PENDENTE.equals(status);
    }

    public String gerarComprovante() {
        return "Comprovante{id=" + idTransacao +
                ", tipo='" + tipoTransacao + '\'' +
                ", valor=" + valor +
                ", dataHora='" + dataHora + '\'' +
                ", status='" + status + '\'' +
                '}';
    }
}
