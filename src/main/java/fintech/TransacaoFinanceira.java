package fintech;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.time.format.DateTimeFormatter;

public class TransacaoFinanceira {

    private Integer idTransacao;
    private String tipoTransacao;
    private BigDecimal valor;
    private String dataHora;
    private String status;

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

    public void processarTransacao(ContaDigital contaOrigem, ContaDigital contaDestino, BigDecimal valorTransferencia) {
        if (contaOrigem == null || contaDestino == null || valorTransferencia == null || valorTransferencia.signum() <= 0) {
            throw new IllegalArgumentException("Dados inválidos para processar transação.");
        }
        contaOrigem.sacar(valorTransferencia);
        contaDestino.depositar(valorTransferencia);
        this.tipoTransacao = "TRANSFERENCIA";
        this.valor = valorTransferencia;
        this.status = "PROCESSADA";
        this.dataHora = LocalDateTime.now().format(DateTimeFormatter.ISO_LOCAL_DATE_TIME);
    }

    public void cancelarTransacao() {
        if (!"PROCESSADA".equals(this.status)) {
            throw new IllegalStateException("Apenas transações processadas podem ser canceladas.");
        }
        this.status = "CANCELADA";
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
