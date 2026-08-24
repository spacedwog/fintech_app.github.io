package fintech;

public class CartaoCredito {

    private String numeroCartao;
    private String bandeira;
    private String nomeTitular;
    private Double limiteDisponivel;
    private Double faturaAtual;

    public CartaoCredito() {
    }

    public CartaoCredito(String numeroCartao, String bandeira, String nomeTitular, Double limiteDisponivel, Double faturaAtual) {
        this.numeroCartao = numeroCartao;
        this.bandeira = bandeira;
        this.nomeTitular = nomeTitular;
        this.limiteDisponivel = limiteDisponivel;
        this.faturaAtual = faturaAtual;
    }

    public void realizarCompra() {
        System.out.println("Objetivo: registrar uma compra realizada no cartão de crédito.");
    }

    public void pagarFatura() {
        System.out.println("Objetivo: realizar o pagamento da fatura do cartão de crédito.");
    }

    public void bloquearCartao() {
        System.out.println("Objetivo: bloquear o cartão de crédito por segurança.");
    }
}
