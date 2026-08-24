package fintech;

public class TransacaoFinanceira {

    private Integer idTransacao;
    private String tipoTransacao;
    private Double valor;
    private String dataHora;
    private String status;

    public TransacaoFinanceira() {
    }

    public TransacaoFinanceira(Integer idTransacao, String tipoTransacao, Double valor, String dataHora, String status) {
        this.idTransacao = idTransacao;
        this.tipoTransacao = tipoTransacao;
        this.valor = valor;
        this.dataHora = dataHora;
        this.status = status;
    }

    public void processarTransacao() {
        System.out.println("Executando método processarTransacao");
    }

    public void cancelarTransacao() {
        System.out.println("Executando método cancelarTransacao");
    }

    public void gerarComprovante() {
        System.out.println("Executando método gerarComprovante");
    }
}
