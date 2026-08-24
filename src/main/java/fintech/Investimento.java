package fintech;

import java.math.BigDecimal;
import java.math.RoundingMode;

public class Investimento extends ProdutoFinanceiro {

    private Integer idInvestimento;
    private String produtoInvestimento;
    private BigDecimal valorAplicado;
    private Double taxaRendimento;
    private Integer prazoMeses;

    public Investimento() {
        System.out.println("Objetivo: inicializar um investimento com valor aplicado zerado.");
        this.valorAplicado = BigDecimal.ZERO;
    }

    public Investimento(Integer idProduto, String nomeProduto, Cliente cliente, Integer idInvestimento, String produtoInvestimento, BigDecimal valorAplicado, Double taxaRendimento, Integer prazoMeses) {
        System.out.println("Objetivo: inicializar um investimento com produto, valor, taxa e prazo.");
        super(idProduto, nomeProduto, cliente);
        this.idInvestimento = idInvestimento;
        this.produtoInvestimento = produtoInvestimento;
        this.valorAplicado = validarValorMonetario(valorAplicado);
        this.taxaRendimento = validarTaxaRendimento(taxaRendimento);
        this.prazoMeses = validarPrazoMeses(prazoMeses);
    }

    public BigDecimal aplicarInvestimento(BigDecimal valorAplicacao) {
        System.out.println("Objetivo: aplicar novo valor válido ao montante do investimento.");
        valorAplicado = valorAplicado.add(validarValorMonetario(valorAplicacao));
        return valorAplicado;
    }

    public BigDecimal resgatarInvestimento(BigDecimal valorResgate) {
        System.out.println("Objetivo: resgatar parte do investimento respeitando o saldo aplicado.");
        BigDecimal valorValido = validarValorMonetario(valorResgate);
        if (valorAplicado.compareTo(valorValido) < 0) {
            throw new IllegalStateException("Valor de resgate maior que o valor aplicado.");
        }
        valorAplicado = valorAplicado.subtract(valorValido);
        return valorAplicado;
    }

    public BigDecimal consultarRendimento() {
        System.out.println("Objetivo: calcular o rendimento estimado com base na taxa informada.");
        BigDecimal fatorTaxa = BigDecimal.valueOf(taxaRendimento / 100.0);
        return valorAplicado.multiply(fatorTaxa).setScale(2, RoundingMode.HALF_UP);
    }

    public BigDecimal consultarValorAplicado() {
        System.out.println("Objetivo: retornar o valor total atualmente aplicado no investimento.");
        return valorAplicado;
    }

    @Override
    public BigDecimal consultarSaldoDisponivel() {
        System.out.println("Objetivo: retornar o saldo disponível do investimento.");
        return valorAplicado;
    }

    @Override
    public String obterTipoProduto() {
        System.out.println("Objetivo: identificar o tipo do produto financeiro como investimento.");
        return "Investimento";
    }

    private Double validarTaxaRendimento(Double taxaRendimento) {
        System.out.println("Objetivo: validar se a taxa de rendimento informada é válida.");
        if (taxaRendimento == null || taxaRendimento < 0) {
            throw new IllegalArgumentException("Taxa de rendimento inválida.");
        }
        return taxaRendimento;
    }

    private Integer validarPrazoMeses(Integer prazoMeses) {
        System.out.println("Objetivo: validar se o prazo do investimento em meses é maior que zero.");
        if (prazoMeses == null || prazoMeses <= 0) {
            throw new IllegalArgumentException("Prazo em meses inválido.");
        }
        return prazoMeses;
    }
}
