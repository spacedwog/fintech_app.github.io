package fintech;

import java.math.BigDecimal;

public abstract class ProdutoFinanceiro {

    private Integer idProduto;
    private String nomeProduto;
    private Cliente cliente;

    public ProdutoFinanceiro() {
        System.out.println("Objetivo: inicializar um produto financeiro sem dados obrigatórios.");
    }

    public ProdutoFinanceiro(Integer idProduto, String nomeProduto, Cliente cliente) {
        System.out.println("Objetivo: inicializar um produto financeiro com identificação, nome e cliente.");
        this.idProduto = idProduto;
        this.nomeProduto = nomeProduto;
        this.cliente = cliente;
    }

    public Integer getIdProduto() {
        System.out.println("Objetivo: retornar o identificador do produto financeiro.");
        return idProduto;
    }

    public void setIdProduto(Integer idProduto) {
        System.out.println("Objetivo: atualizar o identificador do produto financeiro.");
        this.idProduto = idProduto;
    }

    public String getNomeProduto() {
        System.out.println("Objetivo: retornar o nome do produto financeiro.");
        return nomeProduto;
    }

    public void setNomeProduto(String nomeProduto) {
        System.out.println("Objetivo: atualizar o nome do produto financeiro.");
        this.nomeProduto = nomeProduto;
    }

    public Cliente getCliente() {
        System.out.println("Objetivo: retornar o cliente vinculado ao produto financeiro.");
        return cliente;
    }

    public void vincularCliente(Cliente cliente) {
        System.out.println("Objetivo: vincular um cliente ao produto financeiro.");
        this.cliente = cliente;
    }

    protected BigDecimal validarValorMonetario(BigDecimal valor) {
        System.out.println("Objetivo: validar se o valor monetário é não nulo e não negativo.");
        if (valor == null || valor.signum() < 0) {
            throw new IllegalArgumentException("Valor monetário inválido.");
        }
        return valor;
    }

    public abstract BigDecimal consultarSaldoDisponivel();

    public abstract String consultarTipoProduto();
}
