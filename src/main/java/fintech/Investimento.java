package fintech;

import java.math.BigDecimal;

public class Investimento {

    private Integer idInvestimento;
    private String produtoInvestimento;
    private BigDecimal valorAplicado;
    private Double taxaRendimento;
    private Integer prazoMeses;

    public Investimento() {
    }

    public Investimento(Integer idInvestimento, String produtoInvestimento, BigDecimal valorAplicado, Double taxaRendimento, Integer prazoMeses) {
        this.idInvestimento = idInvestimento;
        this.produtoInvestimento = produtoInvestimento;
        this.valorAplicado = valorAplicado;
        this.taxaRendimento = taxaRendimento;
        this.prazoMeses = prazoMeses;
    }

    public void aplicarInvestimento() {
        System.out.println("Objetivo: aplicar valor em um produto de investimento.");
    }

    public void resgatarInvestimento() {
        System.out.println("Objetivo: resgatar valor aplicado em investimento.");
    }

    public void consultarRendimento() {
        System.out.println("Objetivo: consultar o rendimento atual do investimento.");
    }
}
