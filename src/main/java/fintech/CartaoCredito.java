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
        System.out.println("Objetivo: inicializar um cartão de crédito com limite e fatura zerados.");
        this.limiteDisponivel = BigDecimal.ZERO;
        this.faturaAtual = BigDecimal.ZERO;
    }

    public CartaoCredito(Integer idProduto, String nomeProduto, Cliente cliente, String numeroCartao, String bandeira, String nomeTitular, BigDecimal limiteDisponivel, BigDecimal faturaAtual) {
        System.out.println("Objetivo: inicializar um cartão de crédito com dados e valores iniciais.");
        super(idProduto, nomeProduto, cliente);
        this.numeroCartao = numeroCartao;
        this.bandeira = bandeira;
        this.nomeTitular = nomeTitular;
        this.limiteDisponivel = validarValorMonetario(limiteDisponivel);
        this.faturaAtual = validarValorMonetario(faturaAtual);
        this.bloqueado = false;
    }

    public BigDecimal realizarCompra(BigDecimal valorCompra) {
        System.out.println("Objetivo: registrar uma compra no cartão reduzindo limite e aumentando fatura.");
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
        System.out.println("Objetivo: abater a fatura atual e recompor o limite disponível do cartão.");
        BigDecimal valorValido = validarValorMonetario(valorPagamento);
        BigDecimal pagamentoAplicado = valorValido.min(faturaAtual);
        faturaAtual = faturaAtual.subtract(pagamentoAplicado);
        limiteDisponivel = limiteDisponivel.add(pagamentoAplicado);
        return faturaAtual;
    }

    public void bloquearCartao() {
        System.out.println("Objetivo: bloquear o cartão para impedir novas compras.");
        bloqueado = true;
    }

    public BigDecimal consultarFaturaAtual() {
        System.out.println("Objetivo: retornar o valor atual da fatura do cartão.");
        return faturaAtual;
    }

    public BigDecimal consultarLimiteDisponivel() {
        System.out.println("Objetivo: retornar o limite disponível do cartão de crédito.");
        return limiteDisponivel;
    }

    @Override
    public BigDecimal consultarSaldoDisponivel() {
        System.out.println("Objetivo: retornar o limite disponível como saldo do cartão.");
        return limiteDisponivel;
    }

    @Override
    public String obterTipoProduto() {
        System.out.println("Objetivo: identificar o tipo do produto financeiro como cartão de crédito.");
        return "Cartão de Crédito";
    }
}
