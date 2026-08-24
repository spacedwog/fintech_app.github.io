package fintech;

import java.math.BigDecimal;

public abstract class ProdutoFinanceiro {

    private Integer idProduto;
    private String nomeProduto;
    private Cliente cliente;

    public ProdutoFinanceiro() {
    }

    public ProdutoFinanceiro(Integer idProduto, String nomeProduto, Cliente cliente) {
        this.idProduto = idProduto;
        this.nomeProduto = nomeProduto;
        this.cliente = cliente;
    }

    public Integer getIdProduto() {
        return idProduto;
    }

    public void setIdProduto(Integer idProduto) {
        this.idProduto = idProduto;
    }

    public String getNomeProduto() {
        return nomeProduto;
    }

    public void setNomeProduto(String nomeProduto) {
        this.nomeProduto = nomeProduto;
    }

    public Cliente getCliente() {
        return cliente;
    }

    public void vincularCliente(Cliente cliente) {
        this.cliente = cliente;
    }

    protected BigDecimal validarValorMonetario(BigDecimal valor) {
        if (valor == null || valor.signum() < 0) {
            throw new IllegalArgumentException("Valor monetário inválido.");
        }
        return valor;
    }

    public abstract BigDecimal consultarSaldoDisponivel();

    public abstract String obterTipoProduto();
}
