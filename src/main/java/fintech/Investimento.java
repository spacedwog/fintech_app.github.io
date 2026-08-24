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
        this.valorAplicado = BigDecimal.ZERO;
    }

    public Investimento(Integer idProduto, String nomeProduto, Cliente cliente, Integer idInvestimento, String produtoInvestimento, BigDecimal valorAplicado, Double taxaRendimento, Integer prazoMeses) {
        super(idProduto, nomeProduto, cliente);
        this.idInvestimento = idInvestimento;
        this.produtoInvestimento = produtoInvestimento;
        this.valorAplicado = validarValorMonetario(valorAplicado);
        this.taxaRendimento = taxaRendimento;
        this.prazoMeses = prazoMeses;
    }

    public BigDecimal aplicarInvestimento(BigDecimal valorAplicacao) {
        valorAplicado = valorAplicado.add(validarValorMonetario(valorAplicacao));
        return valorAplicado;
    }

    public BigDecimal resgatarInvestimento(BigDecimal valorResgate) {
        BigDecimal valorValido = validarValorMonetario(valorResgate);
        if (valorAplicado.compareTo(valorValido) < 0) {
            throw new IllegalStateException("Valor de resgate maior que o valor aplicado.");
        }
        valorAplicado = valorAplicado.subtract(valorValido);
        return valorAplicado;
    }

    public BigDecimal consultarRendimento() {
        BigDecimal fatorTaxa = BigDecimal.valueOf(taxaRendimento / 100.0);
        return valorAplicado.multiply(fatorTaxa).setScale(2, RoundingMode.HALF_UP);
    }

    public BigDecimal consultarValorAplicado() {
        return valorAplicado;
    }

    @Override
    public BigDecimal consultarSaldoDisponivel() {
        return valorAplicado;
    }

    @Override
    public String obterTipoProduto() {
        return "Investimento";
    }
}
