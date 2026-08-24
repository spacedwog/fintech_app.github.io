package fintech;

public class Investimento {

    private Integer idInvestimento;
    private String produtoInvestimento;
    private Double valorAplicado;
    private Double taxaRendimento;
    private Integer prazoMeses;

    public Investimento() {
    }

    public Investimento(Integer idInvestimento, String produtoInvestimento, Double valorAplicado, Double taxaRendimento, Integer prazoMeses) {
        this.idInvestimento = idInvestimento;
        this.produtoInvestimento = produtoInvestimento;
        this.valorAplicado = valorAplicado;
        this.taxaRendimento = taxaRendimento;
        this.prazoMeses = prazoMeses;
    }

    public void aplicarInvestimento() {
        System.out.println("Executando método aplicarInvestimento");
    }

    public void resgatarInvestimento() {
        System.out.println("Executando método resgatarInvestimento");
    }

    public void consultarRendimento() {
        System.out.println("Executando método consultarRendimento");
    }
}
