package fintech;

import java.math.BigDecimal;

public class CartaoCredito extends ProdutoFinanceiro {

    private String numeroCartao;
    private String bandeira;
    private String nomeTitular;
    private BigDecimal limiteDisponivel;
    private BigDecimal faturaAtual;
    private boolean bloqueado;

    public CartaoCredito() {
        this.limiteDisponivel = BigDecimal.ZERO;
        this.faturaAtual = BigDecimal.ZERO;
    }

    public CartaoCredito(Integer idProduto, String nomeProduto, Cliente cliente, String numeroCartao, String bandeira, String nomeTitular, BigDecimal limiteDisponivel, BigDecimal faturaAtual) {
        super(idProduto, nomeProduto, cliente);
        this.numeroCartao = numeroCartao;
        this.bandeira = bandeira;
        this.nomeTitular = nomeTitular;
        this.limiteDisponivel = validarValorMonetario(limiteDisponivel);
        this.faturaAtual = validarValorMonetario(faturaAtual);
        this.bloqueado = false;
    }

    public BigDecimal realizarCompra(BigDecimal valorCompra) {
        if (bloqueado) {
            throw new IllegalStateException("Cartão bloqueado para compras.");
        }
        BigDecimal valorValido = validarValorMonetario(valorCompra);
        if (limiteDisponivel.compareTo(valorValido) < 0) {
            throw new IllegalStateException("Limite insuficiente.");
        }
        limiteDisponivel = limiteDisponivel.subtract(valorValido);
        faturaAtual = faturaAtual.add(valorValido);
        return faturaAtual;
    }

    public BigDecimal pagarFatura(BigDecimal valorPagamento) {
        BigDecimal valorValido = validarValorMonetario(valorPagamento);
        BigDecimal pagamentoAplicado = valorValido.min(faturaAtual);
        faturaAtual = faturaAtual.subtract(pagamentoAplicado);
        limiteDisponivel = limiteDisponivel.add(pagamentoAplicado);
        return faturaAtual;
    }

    public void bloquearCartao() {
        bloqueado = true;
    }

    public BigDecimal consultarFaturaAtual() {
        return faturaAtual;
    }

    public BigDecimal consultarLimiteDisponivel() {
        return limiteDisponivel;
    }

    @Override
    public BigDecimal consultarSaldoDisponivel() {
        return limiteDisponivel;
    }

    @Override
    public String obterTipoProduto() {
        return "Cartão de Crédito";
    }
}
