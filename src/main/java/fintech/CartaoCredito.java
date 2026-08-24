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
        System.out.println("Executando método realizarCompra");
    }

    public void pagarFatura() {
        System.out.println("Executando método pagarFatura");
    }

    public void bloquearCartao() {
        System.out.println("Executando método bloquearCartao");
    }
}
