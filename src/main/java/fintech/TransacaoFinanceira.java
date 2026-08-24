package fintech;

import java.math.BigDecimal;

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

    public void processarTransacao() {
        System.out.println("Objetivo: processar uma transação financeira no sistema.");
    }

    public void cancelarTransacao() {
        System.out.println("Objetivo: cancelar uma transação financeira pendente.");
    }

    public void gerarComprovante() {
        System.out.println("Objetivo: gerar comprovante de uma transação realizada.");
    }
}
